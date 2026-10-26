import { AsyncLocalStorage } from 'node:async_hooks'
import type { DomainEvent, EventHandler, Invocations } from '../../core'
import { eventOfQueue, inWorker } from '../../core/internal'
import { eventNameMatches } from '../events/event-name-matches'
import { withId } from '../events/with-id'
import type { JobQueueOptions } from './job-queue-options'
import type { Job, JobClosing, Outbox } from '../../port-outbox'

type Registration = { pattern: string, handler: EventHandler, attempts: number, when?: (event: DomainEvent) => boolean }

/** The defaults: `orphansCheckEveryMs`, left out, is `seenEveryMs`. */
const DEFAULTS: Omit<JobQueueOptions, 'orphansCheckEveryMs'> = {
  concurrency: 10,
  pollMs: 5_000,
  leaseMs: 60_000,
  backoffMs: 10_000,
  maxBackoffMs: 15 * 60_000,
  keepDoneMs: 7 * 24 * 60 * 60_000,
  seenEveryMs: 60_000,
}

const DEFAULT_ATTEMPTS = 5

const PURGE_EVERY_MS = 60 * 60_000

/**
 * No context at all: this module's, taken as it loads, before any request or script
 * enters a scope. Jobs run in it, never in that of whoever made the queue (a context
 * opened lazily, inside a request), started the worker or waits for it (`idle`), so
 * a handler has no actor nor scope but the ones it sets itself.
 */
const detached = AsyncLocalStorage.snapshot()

/**
 * The handlers subscribed in `handler` mode, each one a queue, and the worker that
 * runs their jobs.
 * Nothing it does holds the database while a handler runs: claiming, renewing and
 * closing a job are each a single short write in a transaction of its own, and the
 * handler runs between them outside any, like any reaction to an event.
 */
export class JobQueue {

  private readonly registrations = new Map<string, Registration>()
  /** Who holds a lease: this process, until it stops. */
  private readonly worker = Bun.randomUUIDv7()
  /** How many claims it made: each one locks its jobs as `<worker>/<claim>`, a name no claim used before. */
  private claims = 0
  private readonly options: JobQueueOptions
  private readonly inFlight = new Set<Promise<void>>()
  /**
   * The claims on their way, each with the places it took: the jobs it brings are in
   * the database already but not yet in `inFlight`, and count as if they were.
   */
  private readonly claiming = new Map<Promise<unknown>, number>()
  private loop: Promise<void> | null = null
  private running = false
  private woken = false
  private signal: (() => void) | null = null
  private purgedAt = 0
  private seenAt = 0
  private orphansCheckedAt = 0
  /** The queues it warned about, while they stay without a worker: once each, not every minute. */
  private readonly orphansWarned = new Set<string>()

  constructor(
    private readonly store: Outbox,
    private readonly invocations: Invocations,
    options: Partial<JobQueueOptions> = {},
  ) {
    // An option given as undefined takes its default, as one left out does.
    const given: Partial<JobQueueOptions> = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
    this.options = { ...DEFAULTS, orphansCheckEveryMs: given.seenEveryMs ?? DEFAULTS.seenEveryMs, ...given }
    const { concurrency } = this.options
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`A job queue runs at least one job at a time: its concurrency is a whole number from 1, not ${concurrency}`)
  }

  /** A handler of the events `pattern` takes, as a queue: `when` says which of them get a job, all by default. */
  register(name: string, pattern: string, handler: EventHandler, attempts = DEFAULT_ATTEMPTS, when?: (event: DomainEvent) => boolean): () => void {
    if (eventOfQueue(name) !== pattern) throw new Error(`A handler of '${pattern}' is named '<handler's module>.<use case it calls>.on.${pattern}', not '${name}'`)
    if (!Number.isInteger(attempts) || attempts < 1) throw new Error(`The handler '${name}' runs at least once: its attempts are a whole number from 1, not ${attempts}`)
    if (this.registrations.has(name)) throw new Error(`A handler named '${name}' is subscribed already`)
    this.registrations.set(name, { pattern, handler, attempts, when })
    return () => { this.registrations.delete(name) }
  }

  /** One job for each handler the event concerns and takes, in the transaction of the save that publishes it. */
  async enqueue(event: DomainEvent): Promise<void> {
    const told = withId(event)
    const now = new Date().toISOString()
    const jobs: Job[] = [...this.registrations]
      .filter(([, registration]) => eventNameMatches(registration.pattern, told.name) && (registration.when?.(told) ?? true))
      .map(([queue]) => ({ id: Bun.randomUUIDv7(), queue, event: JSON.stringify(told), status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now }))
    if (jobs.length > 0) await this.store.add(jobs)
  }

  /**
   * Runs `fn` as a job runs: in a worker, so its use cases may write to any module,
   * and with no actor nor scope but the ones it sets itself. For a test or a script
   * that does by hand what a worker would.
   */
  runAsWorker<T>(fn: () => T | Promise<T>): Promise<T> {
    return detached(() => inWorker.run(true, async () => fn()))
  }

  /** Starts the worker: the server does; a script that wants its jobs run does too, and waits for `idle`. */
  start(): void {
    if (this.loop) return
    this.running = true
    this.loop = this.work()
  }

  /** Stops claiming, and resolves once the jobs in progress finished. */
  async stop(): Promise<void> {
    this.running = false
    this.signal?.()
    await this.loop
    await Promise.all(this.inFlight)
    this.loop = null
  }

  /** Something was committed: the worker looks at once instead of at its next poll. */
  wake(): void {
    this.woken = true
    this.signal?.()
  }

  /**
   * Resolves once no job is ready nor in progress: for scripts and tests, before they
   * close. It waits for the worker's claims on their way too, whose jobs it would not see.
   */
  async idle(): Promise<void> {
    do await Promise.all([...this.inFlight, ...this.claiming.keys()])
    while (await this.drain() > 0 || this.inFlight.size > 0 || this.claiming.size > 0)
  }

  /**
   * The worker. It runs in the context it was started in, never in a publisher's: a
   * `wake` only resolves what it waits for, so no handler inherits the actor of
   * whatever committed.
   */
  private async work(): Promise<void> {
    while (this.running) {
      this.woken = false
      try {
        await this.seen()
        await this.warnAboutOrphans()
        await this.purge()
        await this.drain()
      } catch (error) {
        console.error('[JobQueue] the worker failed, it goes on at its next poll:', error)
      }
      if (this.running && !this.woken) await this.pause()
    }
  }

  private pause(): Promise<void> {
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined = undefined
      const done = () => {
        clearTimeout(timer)
        this.signal = null
        resolve()
      }
      timer = setTimeout(done, this.options.pollMs)
      this.signal = done
    })
  }

  /**
   * Claims what is ready while there is room, and starts it; how many it started.
   * It does not wait for them: a slow job holds one place, not the worker, and each
   * one that ends wakes the worker to fill its place. The places a claim asks for are
   * taken before it is sent, so the worker and an `idle` draining beside it never run
   * more than `concurrency` together.
   */
  private async drain(): Promise<number> {
    let started = 0
    for (;;) {
      const room = this.options.concurrency - this.inFlight.size - this.taken()
      if (room <= 0) return started
      const claim = this.claim(room)
      const settled = claim.then(() => {}, () => {})
      this.claiming.set(settled, room)
      let claimed: Job[]
      try {
        claimed = await claim
      } finally {
        this.claiming.delete(settled)
      }
      if (claimed.length === 0) return started
      for (const each of claimed) this.track(each)
      started += claimed.length
    }
  }

  /** The places the claims on their way took. */
  private taken(): number {
    let places = 0
    for (const room of this.claiming.values()) places += room
    return places
  }

  private track(claimed: Job): void {
    const run: Promise<void> = this.process(claimed)
      .catch(error => console.error(`[JobQueue] job ${claimed.id} could not be closed, its lease will run out:`, error))
      .finally(() => {
        this.inFlight.delete(run)
        this.wake()
      })
    this.inFlight.add(run)
  }

  /** What is ready and this process knows how to run. */
  private claim(limit: number): Promise<Job[]> {
    const queues = [...this.registrations.keys()]
    if (queues.length === 0) return Promise.resolve([])
    const lockedBy = `${this.worker}/${++this.claims}`
    return this.invocations.run('job.claim', () => this.store.claim(queues, limit, lockedBy, this.later(this.options.leaseMs)))
  }

  private async process(claimed: Job): Promise<void> {
    const registration = this.registrations.get(claimed.queue)
    // Unsubscribed since it was claimed: it goes back to wait for its queue, not at once.
    if (!registration) return this.close(claimed, { status: 'pending', lastError: claimed.lastError, runAfter: this.later(this.options.pollMs) })
    // Its worker stopped mid-run on every attempt it had: running it again would not help.
    if (claimed.attempts > registration.attempts) return this.close(claimed, { status: 'dead', lastError: claimed.lastError ?? 'Its worker stopped before it finished, on every attempt' })

    const heartbeat = setInterval(() => {
      this.renew(claimed).catch(error => console.error(`[JobQueue] renewing the lease of job ${claimed.id} failed:`, error))
    }, this.options.leaseMs / 3)
    try {
      await detached(() => inWorker.run(true, () => registration.handler(JSON.parse(claimed.event) as DomainEvent & { id: string })))
      await this.close(claimed, { status: 'done', lastError: null })
    } catch (error) {
      const lastError = error instanceof Error ? error.stack ?? error.message : String(error)
      await (claimed.attempts >= registration.attempts
        ? this.close(claimed, { status: 'dead', lastError })
        : this.close(claimed, { status: 'pending', lastError, runAfter: this.later(this.backoff(claimed.attempts)) }))
    } finally {
      clearInterval(heartbeat)
    }
  }

  private renew(claimed: Job): Promise<void> {
    return this.invocations.run('job.renew', () => this.store.renew(claimed, this.later(this.options.leaseMs)))
  }

  private close(claimed: Job, closing: JobClosing): Promise<void> {
    return this.invocations.run('job.close', () => this.store.close(claimed, closing))
  }

  /** Registers the queues this worker runs, as they are now, and says they are alive. */
  private async seen(): Promise<void> {
    if (Date.now() - this.seenAt < this.options.seenEveryMs || this.registrations.size === 0) return
    this.seenAt = Date.now()
    await this.invocations.run('job.seen', () => this.store.seen([...this.registrations].map(([name, { pattern, attempts }]) => ({ name, event: pattern, attempts }))))
  }

  /**
   * At start, and then every `orphansCheckEveryMs`: queues with jobs still to run
   * that no worker serves (none here, and none seen elsewhere for five times
   * `seenEveryMs`). A handler renamed or removed leaves its jobs waiting under its old
   * name: someone has to rename them, or run them by hand. Right after a deploy the
   * old process saw the old queue moments ago, so the warning comes a few minutes
   * later, once for each queue.
   */
  private async warnAboutOrphans(): Promise<void> {
    if (Date.now() - this.orphansCheckedAt < this.options.orphansCheckEveryMs) return
    this.orphansCheckedAt = Date.now()
    const alive = new Date(Date.now() - 5 * this.options.seenEveryMs).toISOString()
    const seen = new Map((await this.store.queues()).map(queue => [queue.name, queue.lastSeenAt]))
    const orphans = (await this.store.waiting())
      .filter(({ queue }) => !this.registrations.has(queue) && (seen.get(queue) ?? '') <= alive)
    // A queue served or emptied since is forgotten: if it is left alone again, it warns again.
    for (const queue of this.orphansWarned) {
      if (!orphans.some(orphan => orphan.queue === queue)) this.orphansWarned.delete(queue)
    }
    for (const { queue, jobs } of orphans) {
      if (this.orphansWarned.has(queue)) continue
      this.orphansWarned.add(queue)
      console.warn(`[JobQueue] ${jobs} job(s) of '${queue}' wait, and no worker serves that queue: was its handler renamed or removed?`)
    }
  }

  /** Jobs done are only history: kept a while, then purged. Dead ones stay until someone looks at them. */
  private async purge(): Promise<void> {
    if (Date.now() - this.purgedAt < PURGE_EVERY_MS) return
    this.purgedAt = Date.now()
    await this.invocations.run('job.purge', () => this.store.purge(this.later(-this.options.keepDoneMs)))
  }

  private backoff(attempts: number): number {
    return Math.min(this.options.backoffMs * 2 ** (attempts - 1), this.options.maxBackoffMs)
  }

  private later(ms: number): string {
    return new Date(Date.now() + ms).toISOString()
  }

}
