import type { Job } from './job'

/**
 * How full one queue is now, as a broker would say it: jobs ready to run for the first
 * time, waiting to run again after a failure, running (taken, not done: a broker's
 * unacked) and dead; and since when the oldest one due has waited for a worker.
 */
export type QueueDepth = {
  queue: string
  ready: number
  retrying: number
  running: number
  dead: number
  /** When the oldest job due (pending, its time come) became due: null when none waits. */
  oldestDueAt: string | null
}

/** A queue's depth from its jobs: what an adapter that reads them all (files, a test's memory) says. */
export function depthOf(jobs: Job[], now: string): QueueDepth[] {
  const depths = new Map<string, QueueDepth>()
  for (const job of jobs) {
    if (job.status === 'done') continue
    const depth = depths.get(job.queue) ?? { queue: job.queue, ready: 0, retrying: 0, running: 0, dead: 0, oldestDueAt: null }
    if (job.status === 'pending') {
      depth[job.attempts === 0 ? 'ready' : 'retrying']++
      if (job.runAfter <= now && (depth.oldestDueAt === null || job.runAfter < depth.oldestDueAt)) depth.oldestDueAt = job.runAfter
    } else depth[job.status]++
    depths.set(job.queue, depth)
  }
  return [...depths.values()].sort((a, b) => (a.queue < b.queue ? -1 : 1))
}
