import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { migrationName, type Migrations } from '../port-store'
import type { SqlServerDialect } from './sql-server-dialect'
import { splitStatements } from './split-statements'

type Pair = { version: number, name: string, up: string, down: string }
type Run = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

/**
 * The migrations of a store on a database server: `000NN_<name>_up.sql` and `_down.sql`
 * pairs, remembered in a table (`migrations`, or another for the framework's own).
 * Postgres applies a batch all or none. MySQL commits each statement that changes
 * structure at once, with all that came before it: a batch with none is all or none,
 * and one that fails after one keeps what was committed.
 *
 * Two processes that migrate at once take turns: each holds a lock in the database
 * (an advisory lock, a named lock) while it migrates, and reads what is pending once
 * it has it, so the second finds the first's work done.
 */
export class SqlMigrationRunner implements Migrations {

  constructor(
    private readonly dialect: SqlServerDialect,
    private readonly transaction: <T>(fn: (run: Run) => Promise<T>) => Promise<T>,
    private readonly folder: string | undefined,
    private readonly table = 'migrations',
  ) {}

  async up(): Promise<string[]> {
    await this.ensureTable()
    return this.transaction(async run => {
      await this.lock(run)
      const files = await this.files()
      const applied = await this.applied(run)
      const last = applied.at(-1)
      if (last && !files.some(file => file.version === last.version && file.name === last.name)) {
        throw new Error(`Last applied migration ${migrationName(last.version, last.name)} is not in the migrations folder`)
      }
      const done = new Set(applied.map(record => record.version))
      const pending = files.filter(file => !done.has(file.version))
      for (const migration of pending) {
        for (const statement of this.statements(await Bun.file(migration.up).text())) await run(statement)
        await run(`INSERT INTO ${this.dialect.quote(this.table)} (version, name) VALUES (${this.dialect.param(1)}, ${this.dialect.param(2)})`, [migration.version, migration.name])
      }
      return pending.map(migration => migrationName(migration.version, migration.name))
    })
  }

  async down(): Promise<string | null> {
    await this.ensureTable()
    return this.transaction(async run => {
      await this.lock(run)
      const last = (await this.applied(run)).at(-1)
      if (!last) return null
      const migration = (await this.files()).find(file => file.version === last.version && file.name === last.name)
      if (!migration) throw new Error(`Migration file for ${migrationName(last.version, last.name)} not found`)
      for (const statement of this.statements(await Bun.file(migration.down).text())) await run(statement)
      await run(`DELETE FROM ${this.dialect.quote(this.table)} WHERE version = ${this.dialect.param(1)}`, [migration.version])
      return migrationName(migration.version, migration.name)
    })
  }

  async status(): Promise<{ applied: string[], pending: string[] }> {
    await this.ensureTable()
    return this.transaction(async run => {
      const applied = await this.applied(run)
      const done = new Set(applied.map(record => record.version))
      return {
        applied: applied.map(record => migrationName(record.version, record.name)),
        pending: (await this.files()).filter(file => !done.has(file.version)).map(file => migrationName(file.version, file.name)),
      }
    })
  }

  /** A script's statements: a Postgres function's body, between dollar quotes, goes whole; a MySQL string may escape a quote with `\`. */
  private statements(sql: string): string[] {
    return splitStatements(sql, { dollarQuotes: this.dialect.name === 'postgres', backslashEscapes: this.dialect.name === 'mysql' })
  }

  /**
   * Makes the table, in a transaction of its own: MySQL commits a `CREATE TABLE` at
   * once, so in the migrations' transaction it would end it before they run.
   */
  private async ensureTable(): Promise<void> {
    await this.transaction(async run => {
      // Two Postgres making it at once clash on its name.
      await this.lock(run)
      await run(`CREATE TABLE IF NOT EXISTS ${this.dialect.quote(this.table)} (version INTEGER PRIMARY KEY, name VARCHAR(255) NOT NULL)`)
    })
  }

  /**
   * Waits for whoever else migrates this table in this database, and holds it until the
   * transaction ends: Postgres's advisory lock goes with the transaction; MySQL's named
   * lock is the connection's, and the store lets go of it when the transaction ends.
   */
  private async lock(run: Run): Promise<void> {
    const key = `newt_migrations:${this.table}`
    if (this.dialect.name === 'postgres') {
      await run('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key])
      return
    }
    // A named lock is the whole server's, and its name at most 64 characters: the database's name and the key, hashed.
    const [row] = await run('SELECT GET_LOCK(SHA1(CONCAT(DATABASE(), ?)), -1) AS got', [`:${key}`])
    if (Number(row?.got) !== 1) throw new Error(`The lock on ${this.table} could not be taken`)
  }

  private async applied(run: Run): Promise<{ version: number, name: string }[]> {
    const rows = await run(`SELECT version, name FROM ${this.dialect.quote(this.table)} ORDER BY version`)
    return rows.map(row => ({ version: Number(row.version), name: String(row.name) }))
  }

  private async files(): Promise<Pair[]> {
    if (!this.folder) return []
    let names: string[]
    try {
      names = await readdir(this.folder)
    } catch (error) {
      // A folder named but not there is a path gone wrong, not a database with no migrations.
      throw new Error(`The migrations folder '${this.folder}' cannot be read`, { cause: error })
    }
    const byVersion = new Map<number, Partial<Pair>>()
    for (const fileName of names.sort()) {
      const match = fileName.match(/^(\d{5})_(.+)_(up|down)\.sql$/)
      if (!match) continue
      const [, versionText, name, direction] = match as [string, string, string, string]
      const version = Number.parseInt(versionText, 10)
      const pair = byVersion.get(version) ?? { version, name }
      // Two branches merged may each bring a migration of the same number.
      if (pair.name !== name) throw new Error(`Migrations ${migrationName(version, pair.name!)} and ${migrationName(version, name)} have the same number`)
      pair[direction as 'up' | 'down'] = join(this.folder, fileName)
      byVersion.set(version, pair)
    }
    return [...byVersion.values()].map(pair => {
      if (!pair.up || !pair.down) throw new Error(`Migration ${pair.version}_${pair.name} is missing its ${pair.up ? 'down' : 'up'} file`)
      return pair as Pair
    }).sort((a, b) => a.version - b.version)
  }
}
