import { AsyncLocalStorage } from 'node:async_hooks'

/** What a transaction does at each step, for the adapter that runs it. */
type Steps = {
  begin(): void | Promise<void>
  /** Writes it for good. Once it resolves, the transaction is committed whatever else fails. */
  commit(): void | Promise<void>
  rollback(): void | Promise<void>
  /** Runs last, whatever happened: what `begin` took, it gives back. */
  end?(): void | Promise<void>
}

type Transaction<State> = { open: boolean, state: State, committed: (() => void)[] }

/** How long a call waits for the store by default before it gives up, saying why. */
const WAIT_TIMEOUT_MS = 30_000

/**
 * The machinery every store needs to keep the `Store` promises about transactions,
 * for an adapter to build on instead of copying it:
 * - one transaction at a time, in the order they ask (`exclusive` queues anything else
 *   that must not run in between: a read, a migration);
 * - the current transaction follows the code (`AsyncLocalStorage`), and a call inside
 *   one joins it;
 * - once it starts committing it is closed: a write that comes late runs in a
 *   transaction of its own, after it, instead of being lost;
 * - `afterCommit` runs once it commits, each callback on its own, never on a rollback;
 * - a call that waits too long fails saying why, instead of hanging: the usual cause
 *   is code inside a transaction that lost it (`AsyncLocalStorage.snapshot`, an
 *   `EventEmitter`) and so waits for the very transaction it is part of.
 *
 * `State` is whatever the adapter keeps for each transaction: the files adapter, its
 * pending writes.
 */
export class TransactionScope<State = undefined> {

  private readonly current = new AsyncLocalStorage<Transaction<State>>()
  private queue: Promise<void> = Promise.resolve()

  /**
   * `serial`: transactions take turns, in this process (SQLite, files). A store whose
   * database runs them side by side (Postgres, MySQL) says `false`: each one runs at
   * once, and the database keeps them apart.
   */
  constructor(private readonly waitTimeoutMs = WAIT_TIMEOUT_MS, private readonly serial = true) {}

  /** The state of the transaction in progress, if there is one open here. */
  get state(): State | undefined {
    const transaction = this.current.getStore()
    return transaction?.open ? transaction.state : undefined
  }

  get inTransaction(): boolean {
    return this.current.getStore()?.open === true
  }

  /** Runs `fn` in a new transaction, through `steps`, or in the one in progress. */
  async run<T>(fn: () => T | Promise<T>, state: State, steps: Steps): Promise<T> {
    if (this.inTransaction) return fn()

    const transaction: Transaction<State> = { open: true, state, committed: [] }
    const body = async () => {
      await steps.begin()
      try {
        let value: T
        try {
          value = await this.current.run(transaction, fn)
        } catch (error) {
          transaction.open = false
          await steps.rollback()
          throw error
        }
        transaction.open = false
        try {
          await steps.commit()
        } catch (error) {
          await steps.rollback()
          throw error
        }
        return value
      } finally {
        await steps.end?.()
      }
    }
    const result = this.serial ? await this.exclusive(body) : await body()
    for (const each of transaction.committed) {
      try {
        each()
      } catch (error) {
        console.error('[store] a callback after a commit failed; the transaction is committed:', error)
      }
    }
    return result
  }

  /**
   * For a store whose transactions run one at a time: guarding a key needs nothing
   * more than being in one. A store with concurrent ones takes a lock for each key.
   */
  async guard(_keys: string[]): Promise<void> {
    if (!this.inTransaction) throw new Error('A guard is taken inside a transaction')
    if (!this.serial) throw new Error('A store whose transactions run side by side guards its keys with locks of its own')
  }

  /** Runs `fn` once the transaction in progress commits; at once outside one; never if it rolls back. */
  afterCommit(fn: () => void): void {
    const transaction = this.current.getStore()
    if (transaction?.open) transaction.committed.push(fn)
    else fn()
  }

  /** Runs `fn` once everything before it ended, holding what comes after until it does. */
  exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    let timedOut = false
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const result = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
    const timer = setTimeout(() => {
      timedOut = true
      reject(new Error(`Waited ${this.waitTimeoutMs} ms for the store: a transaction holds it. If this runs inside that transaction, from code that lost it (AsyncLocalStorage.snapshot, an EventEmitter), it waits for itself.`))
    }, this.waitTimeoutMs)
    // The queue follows what runs, not what is answered: one that gave up waiting is skipped.
    this.queue = this.queue.then(async () => {
      clearTimeout(timer)
      if (timedOut) return
      try {
        resolve(await fn())
      } catch (error) {
        reject(error)
      }
    })
    return result
  }

  /** Resolves once everything queued has ended: for closing. */
  async drain(): Promise<void> {
    await this.queue
  }
}
