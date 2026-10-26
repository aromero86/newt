import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { migrationChecksum, migrationName, type Migrations, type MigrationStatus } from '../port-store'
import type { SqlServerDialect } from './sql-server-dialect'
import { splitStatements } from './split-statements'

type Pair = { version: number, name: string, up: string, down: string }
type Run = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>
/** A migration as the database remembers it: applied, and its up script's checksum (none if applied before they were kept). */
type Applied = { version: number, name: string, checksum: string | null }

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
 *
 * It remembers the checksum of each up script it applied, and refuses to go on when
 * one applied was changed since: the database did not run what the folder says.
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
      await this.verifyChecksums(run, applied, files)
      const done = new Set(applied.map(record => record.version))
      const pending = files.filter(file => !done.has(file.version))
      for (const migration of pending) {
        const sql = await Bun.file(migration.up).text()
        for (const statement of this.statements(sql)) await run(statement)
        await run(`INSERT INTO ${this.dialect.quote(this.table)} (version, name, checksum) VALUES (${this.dialect.param(1)}, ${this.dialect.param(2)}, ${this.dialect.param(3)})`, [migration.version, migration.name, migrationChecksum(sql)])
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

  /** What is applied, what is pending, and which applied ones had their up file changed since (which `up` refuses). */
  async status(): Promise<MigrationStatus> {
    await this.ensureTable()
    const applied = await this.transaction(run => this.applied(run))
    const files = await this.files()
    const done = new Set(applied.map(record => record.version))
    const changed: string[] = []
    for (const record of applied) {
      const file = files.find(each => each.version === record.version && each.name === record.name)
      if (file && record.checksum !== null && record.checksum !== migrationChecksum(await Bun.file(file.up).text())) {
        changed.push(migrationName(record.version, record.name))
      }
    }
    return {
      applied: applied.map(record => migrationName(record.version, record.name)),
      pending: files.filter(file => !done.has(file.version)).map(file => migrationName(file.version, file.name)),
      changed,
    }
  }

  /** A script's statements: a Postgres function's body, between dollar quotes, goes whole; a MySQL string may escape a quote with `\`. */
  private statements(sql: string): string[] {
    return splitStatements(sql, { dollarQuotes: this.dialect.name === 'postgres', backslashEscapes: this.dialect.name === 'mysql' })
  }

  /**
   * A migration applied whose up script changed since must not start: the database
   * did not run what the folder says. One applied before checksums were kept is taken
   * as it is, and gets its checksum now.
   */
  private async verifyChecksums(run: Run, applied: Applied[], files: Pair[]): Promise<void> {
    for (const record of applied) {
      const file = files.find(each => each.version === record.version && each.name === record.name)
      if (!file) continue
      const checksum = migrationChecksum(await Bun.file(file.up).text())
      if (record.checksum === null) await run(`UPDATE ${this.dialect.quote(this.table)} SET checksum = ${this.dialect.param(1)} WHERE version = ${this.dialect.param(2)}`, [checksum, record.version])
      else if (record.checksum !== checksum) throw new Error(`Migration ${migrationName(record.version, record.name)} was changed after it was applied: put its up file back as it was, and make the change a new migration`)
    }
  }

  /**
   * Makes the table, in a transaction of its own: MySQL commits a `CREATE TABLE` at
   * once, so in the migrations' transaction it would end it before they run. A table
   * from before checksums were kept gets their column.
   */
  private async ensureTable(): Promise<void> {
    await this.transaction(async run => {
      // Two Postgres making it at once clash on its name.
      await this.lock(run)
      const table = this.dialect.quote(this.table)
      await run(`CREATE TABLE IF NOT EXISTS ${table} (version INTEGER PRIMARY KEY, name VARCHAR(255) NOT NULL, checksum VARCHAR(64))`)
      const schema = this.dialect.name === 'postgres' ? 'current_schema()' : 'DATABASE()'
      const [column] = await run(`SELECT 1 AS found FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = ${this.dialect.param(1)} AND column_name = 'checksum'`, [this.table])
      if (!column) await run(`ALTER TABLE ${table} ADD COLUMN checksum VARCHAR(64)`)
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

  private async applied(run: Run): Promise<Applied[]> {
    const rows = await run(`SELECT version, name, checksum FROM ${this.dialect.quote(this.table)} ORDER BY version`)
    return rows.map(row => ({ version: Number(row.version), name: String(row.name), checksum: typeof row.checksum === 'string' ? row.checksum : null }))
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
