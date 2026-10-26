import { errorCode, type SqlServerDialect } from '../sql'

const COLUMNS = 'id, queue, event, status, attempts, run_after, locked_by, locked_until, last_error, created_at, updated_at'

/**
 * MySQL's SQL: `?` parameters, booleans as 0 and 1, and named locks (`GET_LOCK`) for
 * guards. Its `LOWER()` folds every letter and its usual collations ignore accents, so
 * `ieq` also compares, as they are, the characters beside A to Z: it folds A to Z
 * only, as every store does. Text columns are best `utf8mb4_0900_bin`, so `=` and
 * sorting treat case as the other stores do, and a trailing space makes another value
 * (`utf8mb4_bin` pads: `'ana' = 'ana '`).
 */
export const mysqlDialect: SqlServerDialect = {
  name: 'mysql',
  // READ COMMITTED, as Postgres: under REPEATABLE READ a read before a guard would fix the snapshot, and the rule would miss what the guard's last holder committed.
  begin: ['SET TRANSACTION ISOLATION LEVEL READ COMMITTED', 'START TRANSACTION'],
  failedStatementAborts: false,
  param: () => '?',
  quote: identifier => `\`${identifier.replaceAll('`', '``')}\``,
  always: 'TRUE',
  never: 'FALSE',
  distinct: (column, param) => `NOT (${column} <=> ${param})`,
  ieq: (column, next) => `(LOWER(${column}) = LOWER(${next()}) AND REGEXP_REPLACE(${column}, '[A-Za-z]', '') COLLATE utf8mb4_0900_bin = REGEXP_REPLACE(${next()}, '[A-Za-z]', ''))`,
  boolean: value => (value ? 1 : 0),
  parsesJson: true,
  // ER_DUP_ENTRY
  isCollision: error => errorCode(error) === '1062',
  // ER_LOCK_DEADLOCK, ER_USER_LOCK_DEADLOCK
  isConflict: error => ['1213', '3058'].includes(errorCode(error)),
  changed: result => Number((result as { affectedRows?: number }).affectedRows ?? 0),
  lock: async (connection, keys, waitMs) => {
    const deadline = Date.now() + waitMs
    for (const key of keys) {
      for (;;) {
        const left = deadline - Date.now()
        // A lock's name is the server's, at most 64 characters: a hash of the database's name and the key.
        // GET_LOCK waits whole seconds: with less than one left, it tries without waiting, again and again.
        const [row] = await connection.unsafe("SELECT GET_LOCK(CONCAT('guard:', SHA1(CONCAT(IFNULL(DATABASE(), ''), ':', ?))), ?) AS got", [key, Math.max(0, Math.floor(left / 1000))]) as { got: number }[]
        if (Number(row?.got) === 1) break
        if (Date.now() >= deadline) throw new Error(`Waited ${waitMs} ms for the guard '${key}', which another transaction holds`)
        if (left < 1000) await Bun.sleep(Math.min(20, left))
      }
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
