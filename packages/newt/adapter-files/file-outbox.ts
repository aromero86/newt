import { isSameClaim, type Job, type JobClosing, type JobQuery, type JobQueueRegistration, type Outbox } from '../port-outbox'
import type { FileCollection } from './file-collection'
import type { FileStore } from './file-store'

type QueueRecord = JobQueueRegistration & { id: string, createdAt: string, lastSeenAt: string }

/** The outbox of a files store: the `_jobs` and `_job_queues` collections. */
export class FileOutbox implements Outbox {

  private readonly jobs: FileCollection
  private readonly registrations: FileCollection

  constructor(private readonly store: FileStore) {
    this.jobs = store.collection('_jobs')
    this.registrations = store.collection('_job_queues')
  }

  add(jobs: Job[]): Promise<void> {
    return this.store.transaction(async () => {
      for (const job of jobs) await this.jobs.put(job)
    })
  }

  claim(queues: string[], limit: number, worker: string, leaseUntil: string, now = new Date().toISOString()): Promise<Job[]> {
    return this.store.transaction(async () => {
      const ready = (await this.all())
        .filter(job => queues.includes(job.queue))
        .filter(job => (job.status === 'pending' && job.runAfter <= now) || (job.status === 'running' && job.lockedUntil !== null && job.lockedUntil < now))
        .sort((a, b) => (a.runAfter < b.runAfter ? -1 : a.runAfter > b.runAfter ? 1 : 0))
        .slice(0, limit)
      const claimed = ready.map(job => ({ ...job, status: 'running' as const, lockedBy: worker, lockedUntil: leaseUntil, attempts: job.attempts + 1, updatedAt: now }))
      for (const job of claimed) await this.jobs.put(job)
      return claimed
    })
  }

  renew(claimed: Job, leaseUntil: string): Promise<void> {
    return this.onClaim(claimed, job => ({ ...job, lockedUntil: leaseUntil }))
  }

  close(claimed: Job, closing: JobClosing): Promise<void> {
    return this.onClaim(claimed, job => ({
      ...job,
      status: closing.status,
      lastError: closing.lastError,
      runAfter: closing.runAfter ?? job.runAfter,
      lockedBy: null,
      lockedUntil: null,
    }))
  }

  retry(id: string): Promise<boolean> {
    const now = new Date().toISOString()
    return this.store.transaction(async () => {
      const stored = await this.jobs.get(id) as Job | undefined
      if (stored?.status !== 'dead') return false
      await this.jobs.put({ ...stored, status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, updatedAt: now })
      return true
    })
  }

  seen(queues: JobQueueRegistration[]): Promise<void> {
    const now = new Date().toISOString()
    return this.store.transaction(async () => {
      for (const queue of queues) {
        const before = await this.registrations.get(queue.name) as QueueRecord | undefined
        await this.registrations.put({ id: queue.name, ...queue, createdAt: before?.createdAt ?? now, lastSeenAt: now })
      }
    })
  }

  purge(before: string): Promise<void> {
    return this.store.transaction(async () => {
      for (const job of await this.all()) {
        if (job.status === 'done' && job.updatedAt < before) await this.jobs.remove(job.id)
      }
    })
  }

  async list({ status, after, limit }: JobQuery = {}): Promise<Job[]> {
    const all = (await this.all()).sort(oldestFirst)
    const from = after === undefined ? 0 : (all.findIndex(job => job.id === after) + 1 || all.length)
    const found = all.slice(from).filter(job => status === undefined || job.status === status)
    return limit === undefined ? found : found.slice(0, limit)
  }

  async get(id: string): Promise<Job | undefined> {
    return await this.jobs.get(id) as Job | undefined
  }

  async waiting(): Promise<{ queue: string, jobs: number }[]> {
    return countWaiting(await this.all())
  }

  async queues(): Promise<(JobQueueRegistration & { lastSeenAt: string })[]> {
    const records = (await this.registrations.all()) as QueueRecord[]
    return records
      .map(({ name, event, attempts, lastSeenAt }) => ({ name, event, attempts, lastSeenAt }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  }

  private async all(): Promise<Job[]> {
    return (await this.jobs.all()) as unknown as Job[]
  }

  /** A write on a claimed job, only while it is still the claim it was. */
  private onClaim(claimed: Job, change: (job: Job) => Job): Promise<void> {
    return this.store.transaction(async () => {
      const stored = await this.jobs.get(claimed.id) as Job | undefined
      if (stored && isSameClaim(stored, claimed)) await this.jobs.put({ ...change(stored), updatedAt: new Date().toISOString() })
    })
  }
}

/** By `createdAt`, then `id`. */
function oldestFirst(a: Job, b: Job): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** How many jobs of each queue are still to run, by queue name. */
function countWaiting(jobs: Job[]): { queue: string, jobs: number }[] {
  const counts = new Map<string, number>()
  for (const job of jobs) {
    if (job.status === 'pending' || job.status === 'running') counts.set(job.queue, (counts.get(job.queue) ?? 0) + 1)
  }
  return [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([queue, jobs]) => ({ queue, jobs }))
}
