import { Database } from 'bun:sqlite'

/**
 * The sessions of a monitor whose one context kept them, copied into auth's database
 * once, so nobody signs in again: the monitor's migration that drops them runs after.
 * Nothing to do in memory, with no such database, or once they are gone from it.
 */
export function moveSessions(from: string, to: string): void {
  if (from === ':memory:' || to === ':memory:' || !Bun.file(from).size) return
  const old = new Database(from, { readonly: true })
  try {
    if (!old.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session'`).get()) return
    const rows = old.query('SELECT id, token_hash, expires_at, created_at, updated_at, version FROM session').all()
    const auth = new Database(to)
    try {
      const insert = auth.prepare(`INSERT OR IGNORE INTO session (id, token_hash, expires_at, created_at, updated_at, version)
        VALUES ($id, $token_hash, $expires_at, $created_at, $updated_at, $version)`)
      auth.transaction(() => {
        for (const row of rows as Record<string, string | number>[]) insert.run(Object.fromEntries(Object.entries(row).map(([key, value]) => [`$${key}`, value])))
      })()
    } finally {
      auth.close()
    }
  } finally {
    old.close()
  }
}
