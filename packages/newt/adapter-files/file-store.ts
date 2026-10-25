import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TransactionScope, type Store, type StoredRow, type TableOptions } from '../port-store'
import { FileCollection } from './file-collection'
import { FileMigrations } from './file-migrations'
import { FileOutbox } from './file-outbox'
import type { FileRecord } from './file-record'
import type { FileStoreOptions } from './file-store-options'
import { FileTable } from './file-table'
import { lock } from './lock'
import { namesIn } from './names-in'
import { readIfAny } from './read-if-any'
import { removeIfAny } from './remove-if-any'
import { writeAtomically } from './write-atomically'

/** What a transaction is about to write: by collection, by id, the record or `null` to remove it. */
type Writes = Map<string, Map<string, FileRecord | null>>

type JournalEntry = { collection: string, id: string, record: FileRecord | null }

const JOURNAL = '_journal.json'
const LOCK = '_lock'
const NAME = /^[A-Za-z0-9_-]+$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * One scope per folder in a process, so two stores opened on the same folder take
 * turns as one: the lock file only tells processes apart.
 */
const scopes = new Map<string, TransactionScope<Writes>>()

/**
 * A store of plain files, read and written on the disk as they are: one folder per
 * collection, one JSON file per record (`<folder>/product/<id>.json`).
 *
 * Its transactions are its own: what one writes waits in memory, where it reads it
 * back, and goes to the disk only on commit, through a journal:
 * 1. Every write is put in `_journal.json`, flushed to the disk: that is the commit.
 * 2. Each record is written, whole, over the one before (or removed).
 * 3. The journal goes.
 * A crash before 1 leaves nothing of it; after 1, whoever takes the lock next finds
 * the journal and writes it all again, which writing whole records makes harmless.
 *
 * Everything it does holds one lock, `_lock`, so several processes on one host can
 * share a folder: one transaction or read at a time, in this process and across
 * them. It reads every record of a collection to find some: for thousands of
 * records, not millions.
 */
export class FileStore implements Store {

  readonly outbox: FileOutbox
  readonly migrations: FileMigrations

  private readonly scope: TransactionScope<Writes>

  private constructor(readonly folder: string, options: FileStoreOptions) {
    const key = resolve(folder)
    this.scope = scopes.get(key) ?? new TransactionScope<Writes>(options.waitTimeoutMs)
    scopes.set(key, this.scope)
    this.outbox = new FileOutbox(this)
    this.migrations = new FileMigrations(this, options.migrations ?? [])
  }

  /** Opens a store and brings it up to date. */
  static async open(options: FileStoreOptions): Promise<FileStore> {
    const store = await FileStore.connect(options)
    await store.migrations.up()
    return store
  }

  /** Opens a store as it is, migrating nothing: for the scripts that migrate it. */
  static async connect(options: FileStoreOptions): Promise<FileStore> {
    await mkdir(options.folder, { recursive: true })
    return new FileStore(options.folder, options)
  }

  /** A collection's records as they are, for what a table cannot say: migrations, reports. */
  collection(name: string): FileCollection {
    if (!NAME.test(name)) throw new Error(`A collection is named with letters, numbers, '-' and '_': '${name}' is not`)
    return new FileCollection(this, name)
  }

  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): FileTable<Row> {
    if (name.startsWith('_')) throw new Error(`Collections starting with '_' are the store's own: '${name}'`)
    return new FileTable<Row>(this.collection(name), options)
  }

  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const writes: Writes = new Map()
    let release: (() => Promise<void>) | undefined
    return this.scope.run(fn, writes, {
      begin: async () => { release = await this.lock() },
      commit: () => this.commit(writes),
      rollback: () => {},
      end: () => release?.(),
    })
  }

  /** Its transactions run one at a time: a key is guarded by being in one. */
  guard(keys: string[]): Promise<void> {
    return this.scope.guard(keys)
  }

  afterCommit(fn: () => void): void {
    this.scope.afterCommit(fn)
  }

  async close(): Promise<void> {
    await this.scope.drain()
  }

  /** A record, as the transaction in progress sees it; outside one, as committed. */
  async load(collection: string, id: string): Promise<FileRecord | undefined> {
    const staged = this.scope.state?.get(collection)?.get(id)
    if (staged !== undefined) return staged ? structuredClone(staged) : undefined
    return this.reading(() => this.readRecord(collection, id))
  }

  /** Every record of a collection, as the transaction in progress sees it; outside one, as committed. */
  async loadAll(collection: string): Promise<FileRecord[]> {
    const records = await this.reading(async () => {
      const ids = (await namesIn(join(this.folder, collection))).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))
      const found = await Promise.all(ids.map(id => this.readRecord(collection, id)))
      return new Map(found.filter(record => record !== undefined).map(record => [record.id, record]))
    })
    for (const [id, record] of this.scope.state?.get(collection) ?? []) {
      if (record) records.set(id, structuredClone(record))
      else records.delete(id)
    }
    return [...records.values()]
  }

  /** Writes a record (or removes it, `null`) in the transaction in progress, or in one of its own. */
  stage(collection: string, id: string, record: FileRecord | null): Promise<void> {
    if (!ID.test(id)) throw new Error(`A record's id is made of letters, numbers, '.', '-' and '_': '${id}' is not`)
    return this.transaction(() => {
      const writes = this.scope.state!
      const staged = writes.get(collection) ?? new Map<string, FileRecord | null>()
      staged.set(id, record ? structuredClone(record) : null)
      writes.set(collection, staged)
    })
  }

  /** Inside a transaction it holds the lock already; outside, a read takes it for itself. */
  private reading<T>(fn: () => Promise<T>): Promise<T> {
    if (this.scope.inTransaction) return fn()
    return this.scope.exclusive(async () => {
      const release = await this.lock()
      try {
        return await fn()
      } finally {
        await release()
      }
    })
  }

  /** Takes the lock, and finishes a journal whoever held it last left behind. */
  private async lock(): Promise<() => Promise<void>> {
    const release = await lock(join(this.folder, LOCK))
    try {
      const journal = await readIfAny(join(this.folder, JOURNAL))
      // A journal cut short was never committed: the rename that commits writes it whole.
      if (journal !== undefined) await this.apply(JSON.parse(journal) as JournalEntry[])
    } catch (error) {
      await release()
      throw error
    }
    return release
  }

  /**
   * Commits through the journal. Once the journal is on the disk the transaction is
   * committed: if writing the records fails, the next one to take the lock writes
   * them, so this one is not told it failed.
   */
  private async commit(writes: Writes): Promise<void> {
    const entries: JournalEntry[] = [...writes].flatMap(([collection, records]) => [...records].map(([id, record]) => ({ collection, id, record })))
    if (entries.length === 0) return
    await writeAtomically(join(this.folder, JOURNAL), JSON.stringify(entries))
    try {
      await this.apply(entries)
    } catch (error) {
      console.error('[files] a commit is in the journal but its records could not be written yet; the next lock writes them:', error)
    }
  }

  private async apply(entries: JournalEntry[]): Promise<void> {
    for (const { collection, id, record } of entries) {
      const path = this.path(collection, id)
      if (record) await writeAtomically(path, JSON.stringify(record, null, 2))
      else await removeIfAny(path)
    }
    await removeIfAny(join(this.folder, JOURNAL))
  }

  private async readRecord(collection: string, id: string): Promise<FileRecord | undefined> {
    const text = await readIfAny(this.path(collection, id))
    return text === undefined ? undefined : JSON.parse(text) as FileRecord
  }

  private path(collection: string, id: string): string {
    return join(this.folder, collection, `${id}.json`)
  }
}
