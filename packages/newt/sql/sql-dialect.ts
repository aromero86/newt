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
  /** The columns such a write collided on, where its error names them; none otherwise. */
  collidingColumns?(error: unknown): string[]
  /**
   * Whether null sorts above every value (Postgres): ordering then puts it first going
   * up, as the other stores do, on a column that may hold null (one that cannot is
   * ordered plainly, so its index serves).
   */
  nullsLast?: boolean
  /** Whether its driver hands a JSON column back parsed already (MySQL, Postgres), not as the text it was given. */
  parsesJson?: boolean
  /** A parameter that holds JSON text, written so the column takes it as JSON (Postgres): where it does as it is, none. */
  json?(param: string): string
  /** Whether its text cannot hold the NUL character (Postgres): a value with one matches nothing, and writing one is refused. */
  refusesNul?: boolean
  /**
   * Where a table learns of its columns from the database (Postgres): the query that
   * lists, for the table its one parameter names (quoted), each column's `name`,
   * whether it may hold null (`nullable`), whether it is a big integer (`big`), which
   * the driver hands back as text, and whether it is JSON (`json`), which it parses.
   */
  columns?: string
  /** A transaction the database gave up to keep others apart (a deadlock, a serialization failure): try again. */
  isConflict(error: unknown): boolean
}
