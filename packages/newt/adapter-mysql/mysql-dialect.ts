import { createHash } from 'node:crypto'
import { errorCode, type SqlServerDialect } from '../sql'

const COLUMNS = 'id, queue, event, status, attempts, run_after, locked_by, locked_until, last_error, created_at, updated_at'

/**
 * MySQL's SQL: `?` parameters, booleans as 0 and 1, and named locks (`GET_LOCK`) for
 * guards. Its `LOWER()` folds every letter and its usual collations ignore accents, so
 * `ieq` also compares, as they are, the characters beside A to Z: it folds A to Z
 * only, as every store does. Text columns are best `utf8mb4_bin`, so `=` and sorting
 * treat case as the other stores do.
 */
export const mysqlDialect: SqlServerDialect = {
  name: 'mysql',
  begin: 'START TRANSACTION',
  failedStatementAborts: false,
  param: () => '?',
  quote: identifier => `\`${identifier.replaceAll('`', '``')}\``,
  always: 'TRUE',
  never: 'FALSE',
  distinct: (column, param) => `NOT (${column} <=> ${param})`,
  ieq: (column, next) => `(LOWER(${column}) = LOWER(${next()}) AND REGEXP_REPLACE(${column}, '[A-Za-z]', '') COLLATE utf8mb4_bin = REGEXP_REPLACE(${next()}, '[A-Za-z]', ''))`,
  boolean: value => (value ? 1 : 0),
  // ER_DUP_ENTRY
  isCollision: error => errorCode(error) === '1062',
  // ER_LOCK_DEADLOCK, ER_USER_LOCK_DEADLOCK
  isConflict: error => ['1213', '3058'].includes(errorCode(error)),
  changed: result => Number((result as { affectedRows?: number }).affectedRows ?? 0),
  lock: async (connection, keys, waitMs) => {
    for (const key of keys) {
      // A lock's name is at most 64 characters: a hash of the key keeps it short.
      const name = `guard:${createHash('sha1').update(key).digest('hex')}`
      const [row] = await connection.unsafe('SELECT GET_LOCK(?, ?) AS got', [name, Math.max(1, Math.ceil(waitMs / 1000))]) as { got: number }[]
      if (Number(row?.got) !== 1) throw new Error(`Waited ${waitMs} ms for the guard '${key}', which another transaction holds`)
    }
  },
  // Named locks belong to the connection, not the transaction: they go when it ends.
  release: async connection => { await connection.unsafe('SELECT RELEASE_ALL_LOCKS()') },
  claim: async (run, queues, limit, worker, leaseUntil, now) => {
    const ready = await run(`
      SELECT id FROM job
      WHERE queue IN (${queues.map(() => '?').join(', ')})
        AND ((status = 'pending' AND run_after <= ?) OR (status = 'running' AND locked_until < ?))
      ORDER BY run_after
      LIMIT ${Math.floor(limit)}
      FOR UPDATE SKIP LOCKED`, [...queues, now, now])
    const ids = ready.map(row => row.id)
    if (ids.length === 0) return []
    const among = ids.map(() => '?').join(', ')
    await run(`UPDATE job SET status = 'running', locked_by = ?, locked_until = ?, attempts = attempts + 1, updated_at = ? WHERE id IN (${among})`, [worker, leaseUntil, now, ...ids])
    return run(`SELECT ${COLUMNS} FROM job WHERE id IN (${among}) ORDER BY run_after`, ids)
  },
  upsertQueue: `
    INSERT INTO job_queue (name, event, attempts, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?) AS fresh
    ON DUPLICATE KEY UPDATE event = fresh.event, attempts = fresh.attempts, last_seen_at = fresh.last_seen_at`,
}
