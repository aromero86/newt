import { afterEach, describe, expect, test } from 'bun:test'
import { currentActor, defineScope, now, runAsActor, type Clock, type DomainEvent, type Span, type SpanAttributes, type Tracer } from '../../core'
import { Invocations, inWorker } from '../../core/internal'
import { depthOf, isSameClaim, type Job, type JobClosing, type JobQueueRegistration, type Outbox } from '../../port-outbox'
import { JobQueue } from './job-queue'
import type { JobQueueOptions } from './job-queue-options'

/** An outbox in memory that keeps the port's promises: claims by lease, fenced by the claim's lock and attempts. */
class MemoryOutbox implements Outbox {
  jobs: Job[] = []
  registered: JobQueueRegistration[][] = []
  seenQueues: (JobQueueRegistration & { lastSeenAt: string })[] = []
  purged: string[] = []
  renewals = 0
  /** Runs right after a claim: for a test to change the world in between. */
  onClaim: () => void = () => {}
  /** How long a claim that took jobs takes to come back with them, as a database's would. */
  claimMs = 0
  failRenew = false
  failQueues = false

  async add(jobs: Job[]) {
    this.jobs.push(...jobs.map(job => ({ ...job })))
  }

  async claim(queues: string[], limit: number, worker: string, leaseUntil: string, now = new Date().toISOString()) {
    const ready = this.jobs.filter(job => queues.includes(job.queue) && (
      (job.status === 'pending' && job.runAfter <= now) || (job.status === 'running' && (job.lockedUntil ?? '') < now)
    )).slice(0, limit)
    for (const job of ready) Object.assign(job, { status: 'running', attempts: job.attempts + 1, lockedBy: worker, lockedUntil: leaseUntil })
    this.onClaim()
    const claimed = ready.map(job => ({ ...job }))
    if (claimed.length > 0 && this.claimMs > 0) await Bun.sleep(this.claimMs)
    return claimed
  }

  async renew(claimed: Job, leaseUntil: string) {
    if (this.failRenew) throw new Error('renew failed')
    this.renewals++
    const stored = this.find(claimed)
    if (isSameClaim(stored, claimed)) stored.lockedUntil = leaseUntil
  }

  async close(claimed: Job, closing: JobClosing) {
    const stored = this.find(claimed)
    if (isSameClaim(stored, claimed)) Object.assign(stored, closing, { lockedBy: null, lockedUntil: null })
  }

  async seen(queues: JobQueueRegistration[]) {
    this.registered.push(queues)
  }

  async purge(before: string) {
    this.purged.push(before)
  }

  async list() {
    return this.jobs
  }

  async get(id: string) {
    return this.jobs.find(job => job.id === id)
  }

  async retry() {
    return false
  }

  async waiting() {
    const counts = new Map<string, number>()
    for (const job of this.jobs) if (job.status === 'pending' || job.status === 'running') counts.set(job.queue, (counts.get(job.queue) ?? 0) + 1)
    return [...counts].map(([queue, jobs]) => ({ queue, jobs }))
  }

  async depth(now: string) {
    return depthOf(this.jobs, now)
  }

  async queues() {
    if (this.failQueues) {
      this.failQueues = false
      throw new Error('queues failed')
    }
    return this.seenQueues
  }

  job(queue: string) {
    return this.jobs.find(job => job.queue === queue)!
  }

  private find(claimed: Job) {
    return this.jobs.find(job => job.id === claimed.id)!
  }
}

const QUEUE = 'mail.sendWelcome.on.user.created'

const created = (id = 'u1'): DomainEvent => ({ name: 'user.created', payload: { id }, occurredAt: '' })

function setup(options: Partial<JobQueueOptions> = {}, tracer?: Tracer, clock?: Clock) {
  const outbox = new MemoryOutbox()
  const queue = new JobQueue(outbox, new Invocations(tracer), { pollMs: 10, ...options }, clock)
  return { outbox, queue }
}

const msFromNow = (iso: string | null | undefined) => Date.parse(iso!) - Date.now()

const originalWarn = console.warn
const originalError = console.error

afterEach(() => {
  console.warn = originalWarn
  console.error = originalError
})

describe('register', () => {
  test('a handler is named after who reacts with what to which event', () => {
    const { queue } = setup()

    expect(() => queue.register('mail.sendWelcome.on.user.updated', 'user.created', () => {})).toThrow("'<handler's module>.<use case it calls>.on.user.created'")
    expect(() => queue.register('Mail.sendWelcome.on.user.created', 'user.created', () => {})).toThrow()
    queue.register(QUEUE, 'user.created', () => {})
  })

  test('refuses a concurrency that is not a whole number from 1', () => {
    for (const concurrency of [0, -1, 1.5]) expect(() => setup({ concurrency })).toThrow('concurrency is a whole number from 1')
    setup({ concurrency: 1 })
    setup({ concurrency: undefined })
  })

  test('refuses attempts that are not a whole number from 1', () => {
    const { queue } = setup()

    for (const attempts of [0, -1, 1.5]) expect(() => queue.register(QUEUE, 'user.created', () => {}, attempts)).toThrow('attempts are a whole number from 1')
    queue.register(QUEUE, 'user.created', () => {}, 1)
  })

  test('refuses a name twice, and takes it again once unregistered', () => {
    const { queue } = setup()

    const unregister = queue.register(QUEUE, 'user.created', () => {})
    expect(() => queue.register(QUEUE, 'user.created', () => {})).toThrow('subscribed already')
    unregister()
    queue.register(QUEUE, 'user.created', () => {})
  })
})

describe('enqueue', () => {
  test('writes one pending job for each handler the event concerns', async () => {
    const { outbox, queue } = setup()
    queue.register(QUEUE, 'user.created', () => {})
    queue.register('audit.record.on.user.*', 'user.*', () => {})
    queue.register('mail.sendBye.on.user.deleted', 'user.deleted', () => {})

    await queue.enqueue(created())

    expect(outbox.jobs.map(job => job.queue).sort()).toEqual(['audit.record.on.user.*', QUEUE])
    expect(outbox.job(QUEUE)).toMatchObject({ status: 'pending', attempts: 0, lockedBy: null, lockedUntil: null, lastError: null })
    // The event as it was told, with one id for all of its jobs.
    const [first, second] = outbox.jobs.map(job => JSON.parse(job.event) as DomainEvent)
    expect(first).toEqual({ ...created(), id: expect.any(String) })
    expect(second!.id).toBe(first!.id!)
  })

  test('writes no job for an event a handler does not take', async () => {
    const { outbox, queue } = setup()
    queue.register(QUEUE, 'user.created', () => {}, undefined, event => (event.payload as { id: string }).id !== 'u2')

    await queue.enqueue(created('u1'))
    await queue.enqueue(created('u2'))

    expect(outbox.jobs.map(job => JSON.parse(job.event).payload)).toEqual([{ id: 'u1' }])
  })

  test('writes nothing when no handler is concerned', async () => {
    const { outbox, queue } = setup()
    let added = 0
    outbox.add = async () => { added++ }

    await queue.enqueue(created())

    expect(added).toBe(0)
  })
})

describe('a job', () => {
  test('runs its handler with the event, in a worker, as nobody, and ends done', async () => {
    const { outbox, queue } = setup()
    const seen: unknown[] = []
    queue.register(QUEUE, 'user.created', event => {
      seen.push(event.payload, inWorker.find())
      try {
        currentActor()
      } catch {
        seen.push('nobody')
      }
    })
    await queue.enqueue(created())

    await queue.idle()

    expect(seen).toEqual([{ id: 'u1' }, true, 'nobody'])
    expect(outbox.job(QUEUE)).toMatchObject({ status: 'done', attempts: 1, lastError: null })
  })

  test('that fails waits to run again, twice as long each time, up to a cap', async () => {
    const { outbox, queue } = setup({ backoffMs: 1_000, maxBackoffMs: 1_500 })
    queue.register(QUEUE, 'user.created', () => { throw new Error('smtp down') })
    await queue.enqueue(created())

    await queue.idle()
    const first = outbox.job(QUEUE)
    expect(first).toMatchObject({ status: 'pending', attempts: 1 })
    expect(first.lastError).toContain('smtp down')
    expect(msFromNow(first.runAfter)).toBeGreaterThan(900)
    expect(msFromNow(first.runAfter)).toBeLessThanOrEqual(1_000)

    first.runAfter = new Date(0).toISOString()
    await queue.idle()
    expect(msFromNow(outbox.job(QUEUE).runAfter)).toBeGreaterThan(1_400)
    expect(msFromNow(outbox.job(QUEUE).runAfter)).toBeLessThanOrEqual(1_500)
  })

  test('runs by its clock: due, retried and run again once it moves, with no wait', async () => {
    let time = Date.parse('2026-01-01T00:00:00.000Z')
    const clock: Clock = { now: () => new Date(time) }
    const { outbox, queue } = setup({ backoffMs: 60_000 }, undefined, clock)
    const times: string[] = []
    queue.register(QUEUE, 'user.created', () => {
      times.push(now().toISOString())
      if (times.length === 1) throw new Error('smtp down')
    })
    await queue.enqueue(created())
    expect(outbox.job(QUEUE)).toMatchObject({ createdAt: '2026-01-01T00:00:00.000Z', runAfter: '2026-01-01T00:00:00.000Z' })

    await queue.idle()
    expect(outbox.job(QUEUE)).toMatchObject({ status: 'pending', runAfter: '2026-01-01T00:01:00.000Z' })
    time += 59_000
    await queue.idle()
    expect(times).toHaveLength(1)
    time += 1_000
    await queue.idle()

    expect(outbox.job(QUEUE)).toMatchObject({ status: 'done', attempts: 2 })
    expect(times).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'])
  })

  test('is dead once it failed as many times as its handler allows', async () => {
    const { outbox, queue } = setup()
    queue.register(QUEUE, 'user.created', () => { throw new Error('smtp down') }, 2)
    await queue.enqueue(created())

    await queue.idle()
    outbox.job(QUEUE).runAfter = new Date(0).toISOString()
    await queue.idle()

    expect(outbox.job(QUEUE)).toMatchObject({ status: 'dead', attempts: 2 })
    expect(outbox.job(QUEUE).lastError).toContain('smtp down')
  })

  test('whose worker stopped mid-run on every attempt is dead, without running again', async () => {
    const { outbox, queue } = setup()
    let ran = false
    queue.register(QUEUE, 'user.created', () => { ran = true }, 1)
    await outbox.add([{ ...pendingJob(), status: 'running', attempts: 1, lockedUntil: new Date(0).toISOString() }])

    await queue.idle()

    expect(ran).toBe(false)
    expect(outbox.job(QUEUE)).toMatchObject({ status: 'dead', lastError: 'Its worker stopped before it finished, on every attempt' })
  })

  test('whose handler was unsubscribed once claimed goes back to wait, keeping its last error', async () => {
    const { outbox, queue } = setup({ pollMs: 2_000 })
    const unregister = queue.register(QUEUE, 'user.created', () => {})
    await outbox.add([{ ...pendingJob(), lastError: 'before' }])
    outbox.onClaim = () => unregister()

    await queue.idle()

    expect(outbox.job(QUEUE)).toMatchObject({ status: 'pending', lastError: 'before' })
    expect(msFromNow(outbox.job(QUEUE).runAfter)).toBeGreaterThan(1_900)
  })

  test('keeps its lease while its handler runs, and no longer once it ends', async () => {
    const { outbox, queue } = setup({ leaseMs: 30 })
    queue.register(QUEUE, 'user.created', () => Bun.sleep(40))
    await queue.enqueue(created())

    await queue.idle()
    const renewals = outbox.renewals
    await Bun.sleep(30)

    expect(renewals).toBeGreaterThanOrEqual(2)
    expect(outbox.renewals).toBe(renewals)
  })

  test('whose lease cannot be renewed still runs: the failure is only logged', async () => {
    const { outbox, queue } = setup({ leaseMs: 30 })
    const logged: unknown[] = []
    console.error = (...args: unknown[]) => void logged.push(args[0])
    outbox.failRenew = true
    queue.register(QUEUE, 'user.created', () => Bun.sleep(25))
    await queue.enqueue(created())

    await queue.idle()

    expect(outbox.job(QUEUE).status).toBe('done')
    expect(String(logged[0])).toContain('renewing the lease')
  })
})

describe('the worker', () => {
  test('runs at most `concurrency` jobs at once', async () => {
    const { outbox, queue } = setup({ concurrency: 2 })
    let running = 0
    let most = 0
    queue.register(QUEUE, 'user.created', async () => {
      most = Math.max(most, ++running)
      await Bun.sleep(5)
      running--
    })
    for (const id of ['u1', 'u2', 'u3', 'u4']) await queue.enqueue(created(id))

    await queue.idle()

    expect(most).toBe(2)
    expect(outbox.jobs.every(job => job.status === 'done')).toBe(true)
  })

  test('and an `idle` beside it keep to `concurrency` together', async () => {
    const { outbox, queue } = setup({ concurrency: 2, pollMs: 60_000 })
    outbox.claimMs = 10
    let running = 0
    let most = 0
    queue.register(QUEUE, 'user.created', async () => {
      most = Math.max(most, ++running)
      await Bun.sleep(5)
      running--
    })
    for (const id of ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']) await queue.enqueue(created(id))

    queue.start()
    await Bun.sleep(5)
    await queue.idle()
    await queue.stop()

    expect(most).toBe(2)
    expect(outbox.jobs.every(job => job.status === 'done')).toBe(true)
  })

  test('idle waits for the jobs of a claim the worker has on its way', async () => {
    const { outbox, queue } = setup({ pollMs: 60_000 })
    outbox.claimMs = 20
    let done = false
    queue.register(QUEUE, 'user.created', async () => {
      await Bun.sleep(5)
      done = true
    })
    await queue.enqueue(created())

    queue.start()
    await Bun.sleep(5)
    await queue.idle()
    const doneAtIdle = done
    await queue.stop()

    expect(doneAtIdle).toBe(true)
  })

  test('locks each claim with a name of its own, so none before a retry closes one after it', async () => {
    const { outbox, queue } = setup()
    const locks: (string | null)[] = []
    outbox.onClaim = () => locks.push(...outbox.jobs.filter(job => job.status === 'running').map(job => job.lockedBy))
    queue.register(QUEUE, 'user.created', () => { throw new Error('smtp down') }, 1)
    await queue.enqueue(created())

    await queue.idle()
    Object.assign(outbox.job(QUEUE), { status: 'pending', attempts: 0, runAfter: new Date(0).toISOString() })
    await queue.idle()

    expect(locks).toHaveLength(2)
    expect(locks[0]).not.toBe(locks[1])
  })

  test('starts and stops what runs alongside it: the schedules', async () => {
    const log: string[] = []
    const alongside = { start: () => void log.push('started'), stop: async () => void log.push('stopped') }
    const queue = new JobQueue(new MemoryOutbox(), new Invocations(), { pollMs: 5 }, undefined, alongside)

    queue.start()
    queue.start()
    await queue.stop()

    expect(log).toEqual(['started', 'stopped'])
  })

  test('woken, it looks at once instead of waiting for its poll; stopped, it waits for what runs', async () => {
    const { outbox, queue } = setup({ pollMs: 60_000 })
    queue.register(QUEUE, 'user.created', () => Bun.sleep(20))
    queue.start()
    queue.start()
    await Bun.sleep(5)

    await queue.enqueue(created())
    queue.wake()
    await Bun.sleep(10)
    expect(outbox.job(QUEUE).status).toBe('running')

    await queue.stop()
    expect(outbox.job(QUEUE).status).toBe('done')
  })

  test('says which queues it serves, at most once a minute, and only when it serves some', async () => {
    const idle = setup()
    idle.queue.start()
    await Bun.sleep(5)
    await idle.queue.stop()
    expect(idle.outbox.registered).toEqual([])

    const { outbox, queue } = setup()
    queue.register(QUEUE, 'user.created', () => {}, 3)
    queue.start()
    await Bun.sleep(30)
    await queue.stop()
    queue.start()
    await Bun.sleep(5)
    await queue.stop()

    expect(outbox.registered).toEqual([[{ name: QUEUE, event: 'user.created', attempts: 3 }]])
  })

  test('looks for queues nobody serves as often as it says its own are alive, or as often as it is told', async () => {
    const checks = async (options: Partial<JobQueueOptions>) => {
      const { outbox, queue } = setup({ pollMs: 2, ...options })
      let read = 0
      outbox.queues = async () => (read++, [])
      queue.register(QUEUE, 'user.created', () => {})
      queue.start()
      await Bun.sleep(60)
      await queue.stop()
      return { read, seen: outbox.registered.length }
    }

    expect(await checks({ seenEveryMs: 60_000 })).toEqual({ read: 1, seen: 1 })
    const often = await checks({ seenEveryMs: 60_000, orphansCheckEveryMs: 5 })
    expect(often.seen).toBe(1)
    expect(often.read).toBeGreaterThan(2)
  })

  test('purges the jobs done before their keep, at most once an hour', async () => {
    const { outbox, queue } = setup({ keepDoneMs: 60_000 })
    queue.start()
    await Bun.sleep(30)
    await queue.stop()

    expect(outbox.purged).toHaveLength(1)
    expect(msFromNow(outbox.purged[0])).toBeGreaterThan(-61_000)
    expect(msFromNow(outbox.purged[0])).toBeLessThanOrEqual(-60_000)
  })

  test('warns once about jobs waiting in queues no worker serves', async () => {
    const { outbox, queue } = setup()
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => void warnings.push(String(args[0]))
    queue.register(QUEUE, 'user.created', () => {})
    const recently = new Date().toISOString()
    await outbox.add([
      { ...pendingJob(), id: 'a', queue: 'mail.old.on.user.created', runAfter: '9999' },
      { ...pendingJob(), id: 'b', queue: 'mail.old.on.user.created', status: 'running', lockedUntil: '9999' },
      { ...pendingJob(), id: 'c', queue: 'mail.gone.on.user.created', status: 'done' },
      { ...pendingJob(), id: 'd', queue: 'mail.elsewhere.on.user.created', runAfter: '9999' },
      { ...pendingJob(), id: 'e', queue: QUEUE, runAfter: '9999' },
    ])
    outbox.seenQueues = [{ name: 'mail.elsewhere.on.user.created', event: 'user.created', attempts: 5, lastSeenAt: recently }]

    queue.start()
    await Bun.sleep(30)
    await queue.stop()

    expect(warnings).toEqual([expect.stringContaining("2 job(s) of 'mail.old.on.user.created' wait")])
  })

  test('warns about a queue seen moments ago once nobody has served it for a while, as after a deploy that renamed it', async () => {
    const { outbox, queue } = setup({ pollMs: 5, seenEveryMs: 10 })
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => void warnings.push(String(args[0]))
    queue.register(QUEUE, 'user.created', () => {})
    await outbox.add([{ ...pendingJob(), id: 'a', queue: 'mail.old.on.user.created', runAfter: '9999' }])
    outbox.seenQueues = [{ name: 'mail.old.on.user.created', event: 'user.created', attempts: 5, lastSeenAt: new Date().toISOString() }]

    queue.start()
    await Bun.sleep(20)
    const atStart = [...warnings]
    await Bun.sleep(100)
    await queue.stop()

    expect(atStart).toEqual([])
    expect(warnings).toEqual([expect.stringContaining("1 job(s) of 'mail.old.on.user.created' wait")])
  })

  test('warns again about a queue left alone again, once it was served or emptied', async () => {
    const { outbox, queue } = setup({ pollMs: 5, seenEveryMs: 5 })
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => void warnings.push(String(args[0]))
    queue.register(QUEUE, 'user.created', () => {})
    await outbox.add([{ ...pendingJob(), id: 'a', queue: 'mail.old.on.user.created', runAfter: '9999' }])

    queue.start()
    await Bun.sleep(20)
    outbox.jobs.splice(0)
    await Bun.sleep(20)
    await outbox.add([{ ...pendingJob(), id: 'b', queue: 'mail.old.on.user.created', runAfter: '9999' }])
    await Bun.sleep(20)
    await queue.stop()

    expect(warnings).toHaveLength(2)
  })

  test('runAsWorker runs code as a job runs: in a worker, with no actor, handing back what it gives', async () => {
    const { queue } = setup()
    const invocations = new Invocations(undefined, {}, 'error')
    const write = () => invocations.run('order.place', () => invocations.run('stock.reserve', async () => invocations.checkWrite()))
    await expect(write()).rejects.toThrow('outside a worker')

    const seen = await runAsActor({ userId: 'ana' }, () => queue.runAsWorker(async () => {
      await write()
      let actor = 'none'
      try { actor = currentActor().userId } catch { /* nobody */ }
      return [inWorker.find(), actor]
    }))

    expect(seen).toEqual([true, 'none'])
    expect(inWorker.find()).toBeUndefined()
  })

  test('runs a job with no actor, even when whoever waits for it has one', async () => {
    const { queue } = setup()
    let seen = 'not run'
    queue.register(QUEUE, 'user.created', async () => { try { seen = currentActor().userId } catch { seen = 'none' } })
    await queue.enqueue(created())

    await runAsActor({ userId: 'ana' }, () => queue.idle())

    expect(seen).toBe('none')
  })

  test('runs a job with no actor nor scope, even when the queue was made inside them', async () => {
    const workspace = defineScope<string>('workspace')
    const outbox = new MemoryOutbox()
    // A context opened lazily, the first time a request about it comes in.
    const queue = await runAsActor({ userId: 'ana' }, () => workspace.run('w1', async () => new JobQueue(outbox, new Invocations())))
    let seen: unknown[] = []
    queue.register(QUEUE, 'user.created', async () => {
      try { seen = [currentActor().userId] } catch { seen = ['nobody'] }
      seen.push(workspace.find() ?? 'no workspace')
    })
    await queue.enqueue(created())

    await queue.idle()

    expect(seen).toEqual(['nobody', 'no workspace'])
  })

  test('a failure of its own is logged, and it goes on at its next poll', async () => {
    const { outbox, queue } = setup({ pollMs: 5 })
    const logged: unknown[] = []
    console.error = (...args: unknown[]) => void logged.push(args[0])
    outbox.failQueues = true
    queue.register(QUEUE, 'user.created', () => {})
    await queue.enqueue(created())

    queue.start()
    await Bun.sleep(30)
    await queue.stop()

    expect(String(logged[0])).toContain('the worker failed')
    expect(outbox.job(QUEUE).status).toBe('done')
  })

  test('each of its steps is a span', async () => {
    const spans: string[] = []
    const tracer: Tracer = {
      startActiveSpan<T>(name: string, _attributes: SpanAttributes, fn: (span: Span) => Promise<T>) {
        spans.push(name)
        return fn({ setError() {}, addEvent() {}, end() {} })
      },
    }
    const { queue } = setup({}, tracer)
    queue.register(QUEUE, 'user.created', () => {})
    await queue.enqueue(created())

    await queue.idle()

    expect(spans).toContain('job.claim')
    expect(spans).toContain('job.close')
  })
})

function pendingJob(): Job {
  return {
    id: Bun.randomUUIDv7(),
    queue: QUEUE,
    event: JSON.stringify(created()),
    status: 'pending',
    attempts: 0,
    runAfter: new Date(0).toISOString(),
    lockedBy: null,
    lockedUntil: null,
    lastError: null,
    createdAt: '',
    updatedAt: '',
  }
}
