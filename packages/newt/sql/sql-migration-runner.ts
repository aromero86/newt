import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { migrationName, type Migrations } from '../port-store'
import type { SqlServerDialect } from './sql-server-dialect'
import { splitStatements } from './split-statements'

type Pair = { version: number, name: string, up: string, down: string }

/**
 * The migrations of a store on a database server: `000NN_<name>_up.sql` and `_down.sql`
 * pairs, remembered in a table (`migrations`, or another for the framework's own).
 * Postgres applies a batch all or none; MySQL commits each statement that changes
 * structure on its own, so a batch that fails halfway leaves what it did.
 */
export class SqlMigrationRunner implements Migrations {

  constructor(
    private readonly dialect: SqlServerDialect,
    private readonly transaction: <T>(fn: (run: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>) => Promise<T>,
    private readonly folder: string | undefined,
    private readonly table = 'migrations',
  ) {}

  up(): Promise<string[]> {
    return this.transaction(async run => {
      await this.ensureTable(run)
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

  down(): Promise<string | null> {
    return this.transaction(async run => {
      await this.ensureTable(run)
      const last = (await this.applied(run)).at(-1)
      if (!last) return null
      const migration = (await this.files()).find(file => file.version === last.version && file.name === last.name)
      if (!migration) throw new Error(`Migration file for ${migrationName(last.version, last.name)} not found`)
      for (const statement of this.statements(await Bun.file(migration.down).text())) await run(statement)
      await run(`DELETE FROM ${this.dialect.quote(this.table)} WHERE version = ${this.dialect.param(1)}`, [migration.version])
      return migrationName(migration.version, migration.name)
    })
  }

  /** A script's statements: a Postgres function's body, between dollar quotes, goes whole. */
  private statements(sql: string): string[] {
    return splitStatements(sql, { dollarQuotes: this.dialect.name === 'postgres' })
  }

  status(): Promise<{ applied: string[], pending: string[] }> {
    return this.transaction(async run => {
      await this.ensureTable(run)
      const applied = await this.applied(run)
      const done = new Set(applied.map(record => record.version))
      return {
        applied: applied.map(record => migrationName(record.version, record.name)),
        pending: (await this.files()).filter(file => !done.has(file.version)).map(file => migrationName(file.version, file.name)),
      }
    })
  }

  private async ensureTable(run: (sql: string) => Promise<unknown>): Promise<void> {
    await run(`CREATE TABLE IF NOT EXISTS ${this.dialect.quote(this.table)} (version INTEGER PRIMARY KEY, name VARCHAR(255) NOT NULL)`)
  }

  private async applied(run: (sql: string) => Promise<Record<string, unknown>[]>): Promise<{ version: number, name: string }[]> {
    const rows = await run(`SELECT version, name FROM ${this.dialect.quote(this.table)} ORDER BY version`)
    return rows.map(row => ({ version: Number(row.version), name: String(row.name) }))
  }

  private async files(): Promise<Pair[]> {
    if (!this.folder) return []
    let names: string[]
    try {
      names = await readdir(this.folder)
    } catch {
      return []
    }
    const byVersion = new Map<number, Partial<Pair>>()
    for (const fileName of names) {
      const match = fileName.match(/^(\d{5})_(.+)_(up|down)\.sql$/)
      if (!match) continue
      const [, versionText, name, direction] = match as [string, string, string, string]
      const version = Number.parseInt(versionText, 10)
      const pair = byVersion.get(version) ?? { version, name }
      pair[direction as 'up' | 'down'] = join(this.folder, fileName)
      byVersion.set(version, pair)
    }
    return [...byVersion.values()].map(pair => {
      if (!pair.up || !pair.down) throw new Error(`Migration ${pair.version}_${pair.name} is missing its ${pair.up ? 'down' : 'up'} file`)
      return pair as Pair
    }).sort((a, b) => a.version - b.version)
  }
}
