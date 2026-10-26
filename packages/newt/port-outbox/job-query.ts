import type { Job } from './job'

/** Which jobs `list` reads, oldest first: of one `status`, from the one after the job `after` (its id), up to `limit`. */
export type JobQuery = {
  status?: Job['status']
  /** The id of the last job of the page before: the jobs after it. One no longer kept (purged) has none after it. */
  after?: string
  limit?: number
}
