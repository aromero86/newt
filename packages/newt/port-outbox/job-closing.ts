import type { Job } from './job'

/** How a claim ends: done, dead, or pending again to be tried later. */
export type JobClosing = Pick<Job, 'lastError'> & { status: 'pending' | 'done' | 'dead', runAfter?: string }
