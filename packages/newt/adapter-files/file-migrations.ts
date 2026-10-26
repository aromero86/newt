import { migrationName, type Migrations, type MigrationStatus } from '../port-store'
import type { FileCollection } from './file-collection'
import type { FileStore } from './file-store'
import type { FileMigration } from './file-migration'

type AppliedRecord = { id: string, version: number, name: string, appliedAt: string }

/** The migrations of a files store, remembered in its `_migrations` collection. */
export class FileMigrations implements Migrations {

  private readonly applied: FileCollection

  constructor(private readonly store: FileStore, private readonly migrations: FileMigration[]) {
    const versions = migrations.map(migration => migration.version)
    if (new Set(versions).size !== versions.length) throw new Error('Two migrations share a version')
    this.migrations = [...migrations].sort((a, b) => a.version - b.version)
    this.applied = store.collection('_migrations')
  }

  up(): Promise<string[]> {
    return this.store.transaction(async () => {
      const applied = await this.records()
      const last = applied.at(-1)
      if (last && !this.migrations.some(migration => migration.version === last.version && migration.name === last.name)) {
        throw new Error(`Last applied migration ${migrationName(last.version, last.name)} is not among the store's migrations`)
      }
      const done = new Set(applied.map(record => record.version))
      const pending = this.migrations.filter(migration => !done.has(migration.version))
      for (const migration of pending) {
        await migration.up(this.store)
        await this.applied.put({ id: String(migration.version).padStart(5, '0'), version: migration.version, name: migration.name, appliedAt: new Date().toISOString() })
      }
      return pending.map(migration => migrationName(migration.version, migration.name))
    })
  }

  down(): Promise<string | null> {
    return this.store.transaction(async () => {
      const last = (await this.records()).at(-1)
      if (!last) return null
      const migration = this.migrations.find(each => each.version === last.version && each.name === last.name)
      if (!migration) throw new Error(`Migration ${migrationName(last.version, last.name)} is not among the store's migrations`)
      await migration.down(this.store)
      await this.applied.remove(last.id)
      return migrationName(migration.version, migration.name)
    })
  }

  /** Its migrations are code, with no file to change under it: none is ever `changed`. */
  async status(): Promise<MigrationStatus> {
    const applied = await this.records()
    const done = new Set(applied.map(record => record.version))
    return {
      applied: applied.map(record => migrationName(record.version, record.name)),
      pending: this.migrations.filter(migration => !done.has(migration.version)).map(migration => migrationName(migration.version, migration.name)),
      changed: [],
    }
  }

  private async records(): Promise<AppliedRecord[]> {
    return ((await this.applied.all()) as AppliedRecord[]).sort((a, b) => a.version - b.version)
  }
}
