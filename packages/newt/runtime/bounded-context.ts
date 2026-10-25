import type { Base } from './base'

/**
 * One context of an application: its own store, its own modules and, if it serves
 * them, its own entry points. A context reaches another only through that one's use
 * cases and events: it never opens another's store.
 *
 * Contexts depend on each other as a tree: each one is opened after the ones it uses,
 * and receives them, so none uses one opened after it.
 */
export abstract class BoundedContext<B extends Base = Base> {

  protected constructor(
    readonly name: string,
    readonly base: B,
  ) {}

  /** Starts the worker of its jobs. */
  start(): void {
    this.base.jobs.start()
  }

  /** Waits for the jobs in progress, then closes its store. */
  async stop(): Promise<void> {
    await this.base.jobs.stop()
    await this.base.close()
  }
}
