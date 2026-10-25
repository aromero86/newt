import type { DomainEvent, EventHandler, Invocations } from '../../core'
import { inWorker } from '../../core/internal'
import { eventNameMatches } from '../events/event-name-matches'
import type { JobQueueOptions } from './job-queue-options'
import type { Job, JobClosing, Outbox } from '../../port-outbox'

type Registration = { pattern: string, handler: EventHandler, attempts: number }

const DEFAULTS: JobQueueOptions = {
  concurrency: 10,
  pollMs: 5_000,
  leaseMs: 60_000,
  backoffMs: 10_000,
  maxBackoffMs: 15 * 60_000,
  keepDoneMs: 7 * 24 * 60 * 60_000,
}

const DEFAULT_ATTEMPTS = 5

const PURGE_EVERY_MS = 60 * 60_000

/** How often a worker says its queues are alive; one unseen for five times this is dead. */
const SEEN_EVERY_MS = 60_000

/** `<handler's module>.<use case it calls>.on.<event>`: `mail.sendWelcome.on.user.created`. */
const NAME = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*\.on\.(.+)$/

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
  private readonly options: JobQueueOptions
  private readonly inFlight = new Set<Promise<void>>()
  private loop: Promise<void> | null = null
  private running = false
  private woken = false
  private signal: (() => void) | null = null
  private purgedAt = 0
  private seenAt = 0
  private orphansChecked = false

  constructor(
    private readonly store: Outbox,
    private readonly invocations: Invocations,
    options: Partial<JobQueueOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options }
  }

  register(name: string, pattern: string, handler: EventHandler, attempts = DEFAULT_ATTEMPTS): () => void {
    if (NAME.exec(name)?.[1] !== pattern) throw new Error(`A handler of '${pattern}' is named '<handler's module>.<use case it calls>.on.${pattern}', not '${name}'`)
    if (this.registrations.has(name)) throw new Error(`A handler named '${name}' is subscribed already`)
    this.registrations.set(name, { pattern, handler, attempts })
    return () => { this.registrations.delete(name) }
  }

  /** One job for each handler the event concerns, in the transaction of the save that publishes it. */
  async enqueue(event: DomainEvent): Promise<void> {
    const now = new Date().toISOString()
    const jobs: Job[] = [...this.registrations]
      .filter(([, registration]) => eventNameMatches(registration.pattern, event.name))
      .map(([queue]) => ({ id: Bun.randomUUIDv7(), queue, event: JSON.stringify(event), status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now }))
    if (jobs.length > 0) await this.store.add(jobs)
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

  /** Resolves once no job is ready nor in progress: for scripts and tests, before they close. */
  async idle(): Promise<void> {
    do await Promise.all(this.inFlight)
    while (await this.drain() > 0 || this.inFlight.size > 0)
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
   * one that ends wakes the worker to fill its place.
   */
  private async drain(): Promise<number> {
    let started = 0
    for (;;) {
      const room = this.options.concurrency - this.inFlight.size
      if (room <= 0) return started
      const claimed = await this.claim(room)
      if (claimed.length === 0) return started
      for (const each of claimed) this.track(each)
      started += claimed.length
    }
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
    return this.invocations.run('job.claim', () => this.store.claim(queues, limit, this.worker, this.later(this.options.leaseMs)))
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
      await inWorker.run(true, () => registration.handler(JSON.parse(claimed.event) as DomainEvent))
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
    if (Date.now() - this.seenAt < SEEN_EVERY_MS || this.registrations.size === 0) return
    this.seenAt = Date.now()
    await this.invocations.run('job.seen', () => this.store.seen([...this.registrations].map(([name, { pattern, attempts }]) => ({ name, event: pattern, attempts }))))
  }

  /**
   * Once, at start: queues with jobs still to run that no worker serves (none here, and
   * none seen elsewhere for a while). A handler renamed or removed leaves its jobs
   * waiting under its old name: someone has to rename them, or run them by hand.
   */
  private async warnAboutOrphans(): Promise<void> {
    if (this.orphansChecked) return
    this.orphansChecked = true
    const alive = new Date(Date.now() - 5 * SEEN_EVERY_MS).toISOString()
    const seen = new Map((await this.store.queues()).map(queue => [queue.name, queue.lastSeenAt]))
    const waiting = new Map<string, number>()
    for (const job of await this.store.list()) {
      if (job.status !== 'pending' && job.status !== 'running') continue
      if (this.registrations.has(job.queue) || (seen.get(job.queue) ?? '') > alive) continue
      waiting.set(job.queue, (waiting.get(job.queue) ?? 0) + 1)
    }
    for (const [queue, jobs] of waiting) {
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
