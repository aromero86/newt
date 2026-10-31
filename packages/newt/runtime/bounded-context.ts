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

  /**
   * Stops the worker of its jobs, once those in progress end. Its store stays open:
   * the handlers other contexts subscribed to its events, which its worker runs, write
   * theirs, so an application stops every worker before it closes any store.
   */
  async stopWorker(): Promise<void> {
    await this.base.jobs.stop()
  }

  /** Closes its store, once its worker, and every worker that runs its handlers, stopped. */
  async close(): Promise<void> {
    await this.base.close()
  }

  /** Stops its worker, then closes its store: a context on its own, as a test opens it. */
  async stop(): Promise<void> {
    await this.stopWorker()
    await this.close()
  }
}
