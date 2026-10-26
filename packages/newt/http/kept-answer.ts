/**
 * The first answer to a request with an `Idempotency-Key`, as its table keeps it. In
 * SQL, a table of its own, with an index on when each key is forgotten: the forgotten
 * ones are removed by it.
 *
 * ```sql
 * CREATE TABLE idempotency_key (
 *   id TEXT PRIMARY KEY, version INTEGER NOT NULL, body_hash TEXT NOT NULL,
 *   status INTEGER NOT NULL, headers TEXT NOT NULL, body TEXT NOT NULL, expires_at TEXT NOT NULL
 * );
 * CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);
 * ```
 */
export type KeptAnswer = {
  /** The key's hash, with who sent it and where. */
  id: string
  version: number
  /** The hash of the request's body: the same key with another body is refused. */
  bodyHash: string
  /** Its status; 0 while the first request is still in progress. */
  status: number
  /** Its headers, as JSON: `[name, value][]`. */
  headers: string
  body: string
  /**
   * When the key is forgotten: an ISO date. While the first request is in progress, a
   * minute after it began (or `ttlMs`, if shorter): if its process dies, the key may be
   * taken again then.
   */
  expiresAt: string
}
