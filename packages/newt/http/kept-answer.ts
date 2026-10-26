/**
 * The first answer to a request with an `Idempotency-Key`, as its table keeps it. In
 * SQL, a table of its own:
 *
 * ```sql
 * CREATE TABLE idempotency_key (
 *   id TEXT PRIMARY KEY, version INTEGER NOT NULL,
 *   status INTEGER NOT NULL, headers TEXT NOT NULL, body TEXT NOT NULL, expires_at TEXT NOT NULL
 * );
 * ```
 */
export type KeptAnswer = {
  /** The key's hash, with who sent it and where. */
  id: string
  version: number
  /** Its status; 0 while the first request is still in progress. */
  status: number
  /** Its headers, as JSON: `[name, value][]`. */
  headers: string
  body: string
  /** When the key is forgotten: an ISO date. */
  expiresAt: string
}
