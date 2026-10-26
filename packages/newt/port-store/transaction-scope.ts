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

type Transaction<State> = { open: boolean, state: State, committed: (() => void)[], rolledBack: (() => void)[] }

/** How long a call waits for the store by default before it gives up, saying why. */
const WAIT_TIMEOUT_MS = 30_000

/**
 * The machinery every store needs to keep the `Store` promises about transactions,
 * for an adapter to build on instead of copying it:
 * - one transaction at a time, in the order they ask (`exclusive` queues anything else
 *   that must not run in between: a read, a migration);
 * - the current transaction follows the code (`AsyncLocalStorage`), and a call inside
 *   one joins it;
 * - once it starts committing or rolling back it is closed: a call that belongs to it
 *   and comes late (left unawaited, or a branch of a `Promise.all` still running when
 *   another threw) fails, instead of running outside it;
 * - `afterCommit` runs once it commits, each callback on its own, never on a rollback;
 *   `afterRollback`, once it rolls back, latest first, never on a commit;
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

  /** Whether this code belongs to a transaction that has ended: whatever it asks of the store now fails. */
  get ended(): boolean {
    return this.current.getStore()?.open === false
  }

  /** Throws if this code belongs to a transaction that has ended. */
  assertNotEnded(): void {
    if (this.ended) throw new Error('This call belongs to a transaction that has ended: it came after the transaction committed or rolled back (a call left unawaited, or a branch of a Promise.all still running when another threw). Await every call inside a transaction.')
  }

  /** Runs `fn` in a new transaction, through `steps`, or in the one in progress. */
  async run<T>(fn: () => T | Promise<T>, state: State, steps: Steps): Promise<T> {
    if (this.inTransaction) return fn()
    this.assertNotEnded()

    const transaction: Transaction<State> = { open: true, state, committed: [], rolledBack: [] }
    let committed = false
    const body = async () => {
      await steps.begin()
      try {
        let value: T
        try {
          value = await this.current.run(transaction, fn)
        } catch (error) {
          transaction.open = false
          await rollback(steps)
          throw error
        }
        transaction.open = false
        try {
          await steps.commit()
          committed = true
        } catch (error) {
          await rollback(steps)
          throw error
        }
        return value
      } finally {
        await steps.end?.()
      }
    }
    let result: T
    try {
      result = this.serial ? await this.exclusive(body) : await body()
    } catch (error) {
      if (!committed) this.runEach(transaction.rolledBack.reverse(), 'a callback after a rollback failed; the transaction is rolled back:')
      throw error
    }
    this.runEach(transaction.committed, 'a callback after a commit failed; the transaction is committed:')
    return result
  }

  private runEach(callbacks: (() => void)[], failure: string): void {
    for (const each of callbacks) {
      try {
        each()
      } catch (error) {
        console.error(`[store] ${failure}`, error)
      }
    }
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
    this.assertNotEnded()
    const transaction = this.current.getStore()
    if (transaction?.open) transaction.committed.push(fn)
    else fn()
  }

  /**
   * Runs `fn` if the transaction in progress rolls back, latest first, so each undoes
   * what it was registered for in the reverse order it was done; never outside one.
   */
  afterRollback(fn: () => void): void {
    const transaction = this.current.getStore()
    if (transaction?.open) transaction.rolledBack.push(fn)
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

/** Rolls back after an error: one rolling back raises (a connection lost) is told, and the first one stays the one thrown. */
async function rollback(steps: Steps): Promise<void> {
  try {
    await steps.rollback()
  } catch (error) {
    console.error('[store] rolling back after an error failed too; the first error is the one thrown:', error)
  }
}
