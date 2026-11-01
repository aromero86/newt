import type { ContextJobDTO, JobContext } from '../../../backend/contexts/backoffice/modules/job/job.schema'
import type { Page } from 'newt-kit/contract'
import { type PageRequest, Requester } from 'newt-kit-react'

/** The backoffice's `job` module: the jobs that died in each context. */
export class BackofficeJobApi extends Requester {
  protected readonly path = '/jobs'

  /** A context's dead jobs, the newest first. */
  dead(context: JobContext, page?: PageRequest) {
    return this.get<Page<ContextJobDTO>>(`/${context}`, page)
  }

  /** Puts a dead job back to run: a 409 `outbox.job_not_dead` if it is not dead any more. */
  retry(context: JobContext, jobId: string) {
    return this.post<void>(`/${context}/${jobId}/retry`)
  }
}
