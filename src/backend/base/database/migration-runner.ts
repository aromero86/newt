import type { Database as Sqlite } from 'bun:sqlite'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MigrationFile } from './migration-file'
import type { MigrationRecord } from './migration-record'
import { splitStatements } from './split-statements'

/**
 * Applies and reverts the migrations in a folder: `000NN_<name>_up.sql` and
 * `000NN_<name>_down.sql` pairs, numbered in order. The database keeps the list of
 * what it applied in its `migrations` table.
 */
export class MigrationRunner {

  constructor(
    private readonly sqlite: Sqlite,
    private readonly folder: string,
  ) {}

  /** Applies every pending migration, all of them or none. */
  async up(): Promise<{ applied: string[] }> {
    this.ensureMigrationsTable()

    const files = await this.migrationFiles()
    this.verifyLastAppliedExists(files)

    const appliedVersions = new Set(this.applied().map(record => record.version))
    const pending = files.filter(file => !appliedVersions.has(file.version))
    if (pending.length === 0) return { applied: [] }

    // The SQL is read before the transaction opens: bun:sqlite's `transaction()`
    // commits as soon as its callback returns, so the callback cannot await.
    const sqlByVersion = new Map<number, string>()
    for (const migration of pending) {
      sqlByVersion.set(migration.version, await Bun.file(migration.upPath).text())
    }

    const apply = this.sqlite.transaction(() => {
      for (const migration of pending) {
        for (const statement of splitStatements(sqlByVersion.get(migration.version)!)) {
          this.sqlite.run(statement)
        }
        this.sqlite.run('INSERT INTO migrations (version, name) VALUES (?, ?)', [migration.version, migration.name])
      }
    })
    apply()

    return { applied: pending.map(migration => `${migration.version}_${migration.name}`) }
  }

  /** Reverts the last applied migration. */
  async down(): Promise<{ reverted: string | null }> {
    this.ensureMigrationsTable()

    const last = this.lastApplied()
    if (!last) return { reverted: null }

    const migration = (await this.migrationFiles()).find(file => file.version === last.version && file.name === last.name)
    if (!migration) throw new Error(`Migration file for ${last.version}_${last.name} not found`)

    const sql = await Bun.file(migration.downPath).text()
    const revert = this.sqlite.transaction(() => {
      for (const statement of splitStatements(sql)) {
        this.sqlite.run(statement)
      }
      this.sqlite.run('DELETE FROM migrations WHERE version = ?', [migration.version])
    })
    revert()

    return { reverted: `${migration.version}_${migration.name}` }
  }

  async status(): Promise<{ applied: MigrationRecord[], pending: MigrationFile[] }> {
    this.ensureMigrationsTable()

    const applied = this.applied()
    const appliedVersions = new Set(applied.map(record => record.version))
    const pending = (await this.migrationFiles()).filter(file => !appliedVersions.has(file.version))

    return { applied, pending }
  }

  private ensureMigrationsTable(): void {
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  }

  private applied(): MigrationRecord[] {
    return this.sqlite.query<MigrationRecord, []>('SELECT version, name, created_at FROM migrations ORDER BY version ASC').all()
  }

  private lastApplied(): MigrationRecord | null {
    return this.sqlite.query<MigrationRecord, []>('SELECT version, name, created_at FROM migrations ORDER BY version DESC LIMIT 1').get() ?? null
  }

  private async migrationFiles(): Promise<MigrationFile[]> {
    let names: string[]
    try {
      names = await readdir(this.folder)
    } catch {
      return []
    }

    const byVersion = new Map<number, Partial<MigrationFile>>()
    for (const fileName of names) {
      const match = fileName.match(/^(\d{5})_(.+)_(up|down)\.sql$/)
      if (!match) continue

      const [, versionText, name, direction] = match as [string, string, string, string]
      const version = Number.parseInt(versionText, 10)
      const migration = byVersion.get(version) ?? { version, name }
      byVersion.set(version, migration)

      if (direction === 'up') migration.upPath = join(this.folder, fileName)
      else migration.downPath = join(this.folder, fileName)
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
