import type { Database as Sqlite } from 'bun:sqlite'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { migrationName, type Migrations } from '../port-store'
import type { MigrationFile } from './migration-file'

/** A migration as the database remembers it: applied, and when. */
type MigrationRecord = { version: number, name: string, created_at: string }

/**
 * Applies and reverts the migrations in a folder: `000NN_<name>_up.sql` and
 * `000NN_<name>_down.sql` pairs, numbered in order. The database keeps the list of
 * what it applied in a table: `migrations` for its context's, another for the
 * framework's own (`framework_migrations`), so each one is numbered on its own.
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

    const files = await this.migrationFiles()
    this.verifyLastAppliedExists(files)

    const appliedVersions = new Set(this.applied().map(record => record.version))
    const pending = files.filter(file => !appliedVersions.has(file.version))
    if (pending.length === 0) return []

    // The SQL is read before the transaction opens: bun:sqlite's `transaction()`
    // commits as soon as its callback returns, so the callback cannot await.
    const sqlByVersion = new Map<number, string>()
    for (const migration of pending) {
      sqlByVersion.set(migration.version, await Bun.file(migration.upPath).text())
    }

    const apply = this.sqlite.transaction(() => {
      for (const migration of pending) {
        this.runScript(sqlByVersion.get(migration.version)!)
        this.sqlite.run(`INSERT INTO ${this.table} (version, name) VALUES (?, ?)`, [migration.version, migration.name])
      }
    })
    apply()

    return pending.map(migration => migrationName(migration.version, migration.name))
  }

  /** Reverts the last applied migration. */
  async down(): Promise<string | null> {
    this.ensureMigrationsTable()

    const last = this.lastApplied()
    if (!last) return null

    const migration = (await this.migrationFiles()).find(file => file.version === last.version && file.name === last.name)
    if (!migration) throw new Error(`Migration file for ${last.version}_${last.name} not found`)

    const sql = await Bun.file(migration.downPath).text()
    const revert = this.sqlite.transaction(() => {
      this.runScript(sql)
      this.sqlite.run(`DELETE FROM ${this.table} WHERE version = ?`, [migration.version])
    })
    revert()

    return migrationName(migration.version, migration.name)
  }

  /**
   * Runs a script whole, as SQLite reads it: a trigger's body has semicolons of its
   * own. One with no statement (a down that has nothing to revert) does nothing.
   */
  private runScript(sql: string): void {
    const statements = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/;/g, '')
    if (statements.trim()) this.sqlite.run(sql)
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
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  }

  private applied(): MigrationRecord[] {
    return this.sqlite.query<MigrationRecord, []>(`SELECT version, name, created_at FROM ${this.table} ORDER BY version ASC`).all()
  }

  private lastApplied(): MigrationRecord | null {
    return this.sqlite.query<MigrationRecord, []>(`SELECT version, name, created_at FROM ${this.table} ORDER BY version DESC LIMIT 1`).get() ?? null
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
