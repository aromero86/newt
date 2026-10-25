/**
 * What tells one SQL database from another, for the code they share: how a parameter
 * and a name are written, how some comparisons are said, and how errors read.
 */
export type SqlDialect = {
  /** The text of the n-th parameter, counting from 1: `?` or `$1`. */
  param(n: number): string
  quote(identifier: string): string
  /** What holds for every row, and for none. */
  always: string
  never: string
  /** `column` differs from a value, `null` included (`IS NOT`, `IS DISTINCT FROM`). */
  distinct(column: string, param: string): string
  /** `column` equals a value, ignoring the case of A to Z only, as SQLite's `lower()`: `next` writes a parameter each time it is called. */
  ieq(column: string, next: () => string): string
  /** How a boolean goes in: 1 or 0 where there is no boolean type. */
  boolean(value: boolean): unknown
  /** A write refused because a key or a unique value was taken. */
  isCollision(error: unknown): boolean
  /** A transaction the database gave up to keep others apart (a deadlock, a serialization failure): try again. */
  isConflict(error: unknown): boolean
}
