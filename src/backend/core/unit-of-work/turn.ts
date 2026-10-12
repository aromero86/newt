import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * One unit of work at a time. Every request shares one SQLite connection, which
 * holds a single transaction: a unit of work that began one while another waits on
 * an `await` would fail with "cannot start a transaction within a transaction". So
 * units of work take turns, waiting asynchronously instead of failing.
 *
 * The turn passes down the async context: whatever a unit of work starts while it
 * holds the turn (a nested `transactional: false` use case and the units of work it
 * opens) runs within that turn instead of waiting for it, which would never end.
 */
export class Turn {

  private readonly holder = new AsyncLocalStorage<true>()
  private queue: Promise<void> = Promise.resolve()

  async take<T>(fn: () => Promise<T>): Promise<T> {
    if (this.holder.getStore()) return fn()

    let release!: () => void
    const previous = this.queue
    this.queue = new Promise(resolve => {
      release = resolve
    })
    await previous
    try {
      return await this.holder.run(true, fn)
    } finally {
      release()
    }
  }
}
