import { errorCode, type SqlServerDialect } from '../sql'

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const RETURNING = 'id, queue, event, status, attempts, run_after, locked_by, locked_until, last_error, created_at, updated_at'

/**
 * Postgres's SQL: `$1` parameters, real booleans, and advisory locks for guards. Its
 * `lower()` folds every letter, so `ieq` uses `translate`, to fold A to Z only, as
 * every store does.
 */
export const postgresDialect: SqlServerDialect = {
  name: 'postgres',
  begin: 'BEGIN',
  failedStatementAborts: true,
  param: n => `$${n}`,
  quote: identifier => `"${identifier.replaceAll('"', '""')}"`,
  always: 'TRUE',
  never: 'FALSE',
  distinct: (column, param) => `${column} IS DISTINCT FROM ${param}`,
  ieq: (column, next) => `translate(${column}, '${UPPER}', '${LOWER}') = translate(${next()}, '${UPPER}', '${LOWER}')`,
  boolean: value => value,
  // unique_violation
  isCollision: error => errorCode(error) === '23505',
  // serialization_failure, deadlock_detected
  isConflict: error => ['40001', '40P01'].includes(errorCode(error)),
  changed: result => Number((result as { count?: number }).count ?? 0),
  lock: async (connection, keys, waitMs) => {
    await connection.unsafe(`SET LOCAL lock_timeout = '${Math.max(1, Math.floor(waitMs))}ms'`)
    for (const key of keys) await connection.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key])
  },
  // Its advisory locks are the transaction's: they go with it.
  release: async () => {},
  claim: (run, queues, limit, worker, leaseUntil, now) => run(`
    UPDATE job SET status = 'running', locked_by = $1, locked_until = $2, attempts = attempts + 1, updated_at = $3
    WHERE id IN (
      SELECT id FROM job
      WHERE queue IN (${queues.map((_, i) => `$${i + 5}`).join(', ')})
        AND ((status = 'pending' AND run_after <= $4) OR (status = 'running' AND locked_until < $4))
      ORDER BY run_after
      LIMIT ${Math.floor(limit)}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING ${RETURNING}`, [worker, leaseUntil, now, now, ...queues]),
  upsertQueue: `
    INSERT INTO job_queue (name, event, attempts, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (name) DO UPDATE SET event = EXCLUDED.event, attempts = EXCLUDED.attempts, last_seen_at = EXCLUDED.last_seen_at`,
}
