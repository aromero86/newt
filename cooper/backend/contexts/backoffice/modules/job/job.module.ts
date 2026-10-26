import { Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { Job_Deps } from './job.deps'
import { registerJobRoutes } from './job.routes'
import { JobContextSchema, type ContextJobDTO, type JobContext } from './job.schema'

/**
 * The jobs that died in each context of cooper: a reaction that failed
 * every attempt waits, with its last error, for someone to look. The staff see them
 * here and, once what killed one is fixed, put it back to run. Each context keeps
 * and runs its own jobs: this module only asks each one, through its use cases.
 */
export class Job_Module extends Module {

  static initialize(base: CooperBase, deps: Job_Deps): Job_Module {
    const module = new Job_Module(base, deps)
    registerJobRoutes(base, module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: Job_Deps) {
    super('job', base.invocations)
  }

  /** A page of a context's dead jobs, the newest first. */
  @UseCase()
  async dead(context: JobContext, page: PageRequest): Promise<Page<ContextJobDTO>> {
    const name = JobContextSchema.parse(context)
    const found = await this.deps.outboxes[name].dead(page)
    return { ...found, items: found.items.map(job => ({ ...job, context: name })) }
  }

  /**
   * A dead job of a context runs again: what a person of the staff asks for, at once,
   * once they fixed what killed it. The context's own use case puts it back; its
   * worker runs it. No `writesTo`, not even for the backoffice's own outbox: the
   * write rule watches what repositories save, and a job put back is the store's
   * outbox, written by `outbox.retry` in one step.
   */
  @UseCase()
  async retry(context: JobContext, id: string): Promise<void> {
    await this.deps.outboxes[JobContextSchema.parse(context)].retry(id)
  }
}
