import type { Clock } from '../core'
import type { Table } from '../port-store'
import type { KeptAnswer } from './kept-answer'

/**
 * A POST a client may send again without doing it twice: one with an
 * `Idempotency-Key` header gets the first answer to that key, from the same person
 * at the same address, while the key is remembered. A route's, a group's or a
 * router's option.
 */
export type Idempotency = {
  /** Where the first answers are kept: a table of the context's store, `store.table<KeptAnswer>('idempotency_key')`. */
  table: Table<KeptAnswer>
  /** How long a key is remembered: a day unless told. */
  ttlMs?: number
  /** What tells the time: the context's, when its `Base` has one a test moves. The real time unless told. */
  clock?: Clock
}
