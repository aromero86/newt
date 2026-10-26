import { BackofficeJobApi, JOB_CONTEXTS, type ContextJobDTO, type JobContext } from '@cooper/api/backoffice-job'
import { inject } from '@cooper/core/injector/inject'
import { ListStore } from '@cooper/core/list/list-store'

/** The jobs that died in each context: listed, one list per context, and retried. */
export class JobsService {

  private readonly api = inject(BackofficeJobApi)

  readonly lists = Object.fromEntries(
    JOB_CONTEXTS.map(context => [context, new ListStore<ContextJobDTO>(page => this.api.dead(context, page))]),
  ) as Record<JobContext, ListStore<ContextJobDTO>>

  /** Every context's first page: each tab says how many it has. */
  async load(): Promise<void> {
    await Promise.all(JOB_CONTEXTS.map(context => this.lists[context].loadFirstPage()))
  }

  /** Resolves to the error's message, or null once it is back to run: it leaves the list. */
  async retry(job: ContextJobDTO): Promise<string | null> {
    try {
      await this.api.retry(job.context, job.id)
      this.lists[job.context].remove(job.id)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not retry it'
    }
  }
}
