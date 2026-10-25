import { afterEach, describe, expect, test } from 'bun:test'
import { currentActor, type DomainEvent, type Span, type SpanAttributes, type Tracer } from '../../core'
import { Invocations, inWorker } from '../../core/internal'
import { isSameClaim, type Job, type JobClosing, type JobQueueRegistration, type Outbox } from '../../outbox'
import { JobQueue } from './job-queue'
import type { JobQueueOptions } from './job-queue-options'

/** An outbox in memory that keeps the port's promises: claims by lease, fenced by attempts. */
class MemoryOutbox implements Outbox {
  jobs: Job[] = []
  registered: JobQueueRegistration[][] = []
  seenQueues: (JobQueueRegistration & { lastSeenAt: string })[] = []
  purged: string[] = []
  renewals = 0
  /** Runs right after a claim: for a test to change the world in between. */
  onClaim: () => void = () => {}
  failRenew = false
  failQueues = false

  async add(jobs: Job[]) {
    this.jobs.push(...jobs.map(job => ({ ...job })))
  }

  async claim(queues: string[], limit: number, worker: string, leaseUntil: string) {
    const now = new Date().toISOString()
    const ready = this.jobs.filter(job => queues.includes(job.queue) && (
      (job.status === 'pending' && job.runAfter <= now) || (job.status === 'running' && (job.lockedUntil ?? '') < now)
    )).slice(0, limit)
    for (const job of ready) Object.assign(job, { status: 'running', attempts: job.attempts + 1, lockedBy: worker, lockedUntil: leaseUntil })
    this.onClaim()
    return ready.map(job => ({ ...job }))
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

function setup(options: Partial<JobQueueOptions> = {}, tracer?: Tracer) {
  const outbox = new MemoryOutbox()
  const queue = new JobQueue(outbox, new Invocations(tracer), { pollMs: 10, ...options })
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
    expect(outbox.job(QUEUE)).toMatchObject({ status: 'pending', attempts: 0, lockedBy: null, lockedUntil: null, lastError: null, event: JSON.stringify(created()) })
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
