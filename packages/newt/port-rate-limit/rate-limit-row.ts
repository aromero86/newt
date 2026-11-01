/**
 * What a key did lately, as `TableRateLimitStore` keeps it. In SQL, a table of its own,
 * with an index on when each row is forgotten: the forgotten ones are removed by it.
 *
 * ```sql
 * CREATE TABLE rate_limit (
 *   id TEXT PRIMARY KEY, version INTEGER NOT NULL, start TEXT NOT NULL,
 *   count INTEGER NOT NULL, previous INTEGER NOT NULL, expires_at TEXT NOT NULL
 * );
 * CREATE INDEX rate_limit_expires_at ON rate_limit (expires_at);
 * ```
 */
export type RateLimitRow = {
  /** The key's hash. */
  id: string
  version: number
  /** When its window began: an ISO date. */
  start: string
  /** What it took in its window. */
  count: number
  /** What it took in the window before. */
  previous: number
  /** When it is forgotten, once both windows slid away: an ISO date. */
  expiresAt: string
}
