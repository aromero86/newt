import type { Database as Sqlite } from 'bun:sqlite'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { migrationChecksum, migrationName, type Migrations } from '../port-store'
import type { MigrationFile } from './migration-file'
import { splitStatements } from './split-statements'

/** A migration as the database remembers it: applied, when, and its up script's checksum (none if applied before they were kept). */
type MigrationRecord = { version: number, name: string, created_at: string, checksum: string | null }

/**
 * Applies and reverts the migrations in a folder: `000NN_<name>_up.sql` and
 * `000NN_<name>_down.sql` pairs, numbered in order. The database keeps the list of
 * what it applied in a table: `migrations` for its context's, another for the
 * framework's own (`framework_migrations`), so each one is numbered on its own.
 *
 * It remembers the checksum of each up script it applied, and refuses to go on when
 * one applied was changed since: the database did not run what the folder says.
 */
export class MigrationRunner implements Migrations {

  constructor(
    private readonly sqlite: Sqlite,
    /** None: a database with no migrations of its own. */
    private readonly folder: string | undefined,
    private readonly table = 'migrations',
  ) {}

  /** Applies every pending migration, all of them or none. */
  async up(): Promise<string[]> {
    this.ensureMigrationsTable()

    // Every script is read before the transaction opens: bun:sqlite's `transaction()`
    // commits as soon as its callback returns, so the callback cannot await. Which are
    // pending is read inside it, holding the write lock, so two processes opening the
    // same database apply them once.
    const files = await this.migrationFiles()
    const sqlByVersion = new Map<number, string>()
    for (const migration of files) {
      sqlByVersion.set(migration.version, await Bun.file(migration.upPath).text())
    }

    return this.inTransaction(() => {
      this.verifyLastAppliedExists(files)
      const applied = this.applied()
      this.verifyChecksums(applied, files, sqlByVersion)
      const appliedVersions = new Set(applied.map(record => record.version))
      const pending = files.filter(file => !appliedVersions.has(file.version))
      for (const migration of pending) {
        const sql = sqlByVersion.get(migration.version)!
        this.runScript(sql)
        this.sqlite.run(`INSERT INTO ${this.table} (version, name, checksum) VALUES (?, ?, ?)`, [migration.version, migration.name, migrationChecksum(sql)])
      }
      return pending.map(migration => migrationName(migration.version, migration.name))
    })
  }

  /** Reverts the last applied migration. */
  async down(): Promise<string | null> {
    this.ensureMigrationsTable()

    const last = this.lastApplied()
    if (!last) return null

    const migration = (await this.migrationFiles()).find(file => file.version === last.version && file.name === last.name)
    if (!migration) throw new Error(`Migration file for ${last.version}_${last.name} not found`)

    const sql = await Bun.file(migration.downPath).text()
    this.inTransaction(() => {
      this.runScript(sql)
      this.sqlite.run(`DELETE FROM ${this.table} WHERE version = ?`, [migration.version])
    })

    return migrationName(migration.version, migration.name)
  }

  /**
   * Runs `fn` in a transaction that takes the write lock at once, with foreign keys
   * off: SQLite ignores turning them off inside a transaction, so a script that
   * rebuilds a table the documented way (a new table, copy, drop, rename) would
   * otherwise delete or refuse the rows that point at the old one. A database that
   * keeps its foreign keys refuses a migration that leaves a row pointing nowhere.
   */
  private inTransaction<T>(fn: () => T): T {
    const foreignKeys = this.sqlite.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()?.foreign_keys === 1
    this.sqlite.run('PRAGMA foreign_keys = OFF')
    try {
      return this.sqlite.transaction(() => {
        const value = fn()
        if (foreignKeys) this.verifyForeignKeys()
        return value
      }).immediate()
    } finally {
      if (foreignKeys) this.sqlite.run('PRAGMA foreign_keys = ON')
    }
  }

  private verifyForeignKeys(): void {
    const broken = this.sqlite.query<{ table: string, parent: string }, []>('PRAGMA foreign_key_check').all()
    if (broken.length === 0) return
    const pairs = [...new Set(broken.map(row => `${row.table} → ${row.parent}`))]
    throw new Error(`The migration leaves rows pointing at rows that do not exist: ${pairs.join(', ')}`)
  }

  /**
   * Runs a script one statement at a time, so one that fails fails the script (run
   * whole, SQLite reports only the last one's error). A trigger, with semicolons in
   * its body, is one statement; a script of comments alone runs nothing.
   */
  private runScript(sql: string): void {
    for (const statement of splitStatements(sql)) this.sqlite.run(statement)
  }

  async status(): Promise<{ applied: string[], pending: string[] }> {
    this.ensureMigrationsTable()

    const applied = this.applied()
    const appliedVersions = new Set(applied.map(record => record.version))
    const pending = (await this.migrationFiles()).filter(file => !appliedVersions.has(file.version))

    return {
      applied: applied.map(record => migrationName(record.version, record.name)),
      pending: pending.map(file => migrationName(file.version, file.name)),
    }
  }

  private ensureMigrationsTable(): void {
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        checksum TEXT
      )
    `)
    // A table from before checksums were kept gets their column, holding the write lock, so two processes add it once.
    const hasChecksum = () => this.sqlite.query(`SELECT 1 FROM pragma_table_info('${this.table}') WHERE name = 'checksum'`).get() !== null
    if (hasChecksum()) return
    this.sqlite.transaction(() => {
      if (!hasChecksum()) this.sqlite.run(`ALTER TABLE ${this.table} ADD COLUMN checksum TEXT`)
    }).immediate()
  }

  private applied(): MigrationRecord[] {
    return this.sqlite.query<MigrationRecord, []>(`SELECT version, name, created_at, checksum FROM ${this.table} ORDER BY version ASC`).all()
  }

  private lastApplied(): MigrationRecord | null {
    return this.sqlite.query<MigrationRecord, []>(`SELECT version, name, created_at, checksum FROM ${this.table} ORDER BY version DESC LIMIT 1`).get() ?? null
  }

  /**
   * A migration applied whose up script changed since must not start: the database
   * did not run what the folder says. One applied before checksums were kept is taken
   * as it is, and gets its checksum now.
   */
  private verifyChecksums(applied: MigrationRecord[], files: MigrationFile[], sqlByVersion: Map<number, string>): void {
    for (const record of applied) {
      if (!files.some(file => file.version === record.version && file.name === record.name)) continue
      const checksum = migrationChecksum(sqlByVersion.get(record.version)!)
      if (record.checksum === null) this.sqlite.run(`UPDATE ${this.table} SET checksum = ? WHERE version = ?`, [checksum, record.version])
      else if (record.checksum !== checksum) throw new Error(`Migration ${migrationName(record.version, record.name)} was changed after it was applied: put its up file back as it was, and make the change a new migration`)
    }
  }

  private async migrationFiles(): Promise<MigrationFile[]> {
    if (!this.folder) return []
    const folder = this.folder
    let names: string[]
    try {
      names = await readdir(folder)
    } catch (error) {
      // A folder named but not there is a path gone wrong, not a database with no migrations.
      throw new Error(`The migrations folder '${folder}' cannot be read`, { cause: error })
    }

    const byVersion = new Map<number, Partial<MigrationFile>>()
    for (const fileName of names) {
      const match = fileName.match(/^(\d{5})_(.+)_(up|down)\.sql$/)
      if (!match) continue

      const [, versionText, name, direction] = match as [string, string, string, string]
      const version = Number.parseInt(versionText, 10)
      const migration = byVersion.get(version) ?? { version, name }
      if (migration.name !== name) {
        // Two branches merged, each with a migration of its own under the same number.
        throw new Error(`Migrations ${basename((migration.upPath ?? migration.downPath)!)} and ${fileName} share the version ${versionText}: renumber one`)
      }
      byVersion.set(version, migration)

      if (direction === 'up') migration.upPath = join(folder, fileName)
      else migration.downPath = join(folder, fileName)
    }

    const files: MigrationFile[] = []
    for (const [version, migration] of byVersion) {
      if (!migration.upPath || !migration.downPath) {
        throw new Error(`Migration ${version}_${migration.name} is missing its ${migration.upPath ? 'down' : 'up'} file`)
      }
      files.push(migration as MigrationFile)
    }
    return files.sort((a, b) => a.version - b.version)
  }

  /** A database ahead of the code (the last migration it applied is gone) must not start. */
  private verifyLastAppliedExists(files: MigrationFile[]): void {
    const last = this.lastApplied()
    if (!last) return
    if (!files.some(file => file.version === last.version && file.name === last.name)) {
      throw new Error(`Last applied migration ${last.version}_${last.name} is not in the migrations folder`)
    }
  }
}
