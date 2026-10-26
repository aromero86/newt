import { unlinkSync } from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { ConcurrencyConflict } from '../core'
import { TransactionScope, type Store, type StoredRow, type TableOptions } from '../port-store'
import { FileCollection } from './file-collection'
import { FileMigrations } from './file-migrations'
import { FileOutbox } from './file-outbox'
import type { FileRecord } from './file-record'
import type { FileStoreOptions } from './file-store-options'
import { FileTable } from './file-table'
import { isMissing } from './is-missing'
import { lock, type Lock } from './lock'
import { namesIn } from './names-in'
import { readIfAny } from './read-if-any'
import { writeAtomically } from './write-atomically'

/** What a transaction is about to write: by collection, by id, the record or `null` to remove it. */
type Writes = Map<string, Map<string, FileRecord | null>>

type JournalEntry = { collection: string, id: string, record: FileRecord | null }

const JOURNAL = '_journal.json'
const LOCK = '_lock'
const NAME = /^[A-Za-z0-9_-]{1,100}$/
/** Up to 100 characters: with what a write adds to it, a file name fits any file system. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/**
 * One scope per folder in a process (by its real path, whatever path opened it), so
 * two stores opened on the same folder take turns as one, without the lock file.
 */
const scopes = new Map<string, TransactionScope<Writes>>()

/** For each transaction in progress, what its last `serially` call is. */
const turns = new WeakMap<Writes, Promise<unknown>>()

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
 * What could keep a record from being written for good (a collection or an id the
 * disk cannot name) is refused before 1, so a journal can always be finished once
 * the disk lets it.
 *
 * Everything it does holds one lock, `_lock`, so several processes on one host can
 * share a folder: one transaction or read at a time, in this process and across
 * them. Each file it writes is renamed into place only if the lock is still its own:
 * a transaction whose lock was taken over while its process was stopped fails with a
 * `ConcurrencyConflict` (a use case runs again). It reads every record of a
 * collection to find some: for thousands of records, not millions.
 */
export class FileStore implements Store {

  readonly outbox: FileOutbox
  readonly migrations: FileMigrations

  private readonly scope: TransactionScope<Writes>

  private constructor(readonly folder: string, key: string, options: FileStoreOptions) {
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
    return new FileStore(options.folder, await realpath(options.folder), options)
  }

  /** A collection's records as they are, for what a table cannot say: migrations, reports. */
  collection(name: string): FileCollection {
    if (!NAME.test(name)) throw new Error(`A collection is named with up to 100 letters, numbers, '-' and '_': '${name}' is not`)
    return new FileCollection(this, name)
  }

  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): FileTable<Row> {
    if (name.startsWith('_')) throw new Error(`Collections starting with '_' are the store's own: '${name}'`)
    return new FileTable<Row>(this.collection(name), options)
  }

  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const writes: Writes = new Map()
    let held: Lock | undefined
    return this.scope.run(fn, writes, {
      begin: async () => { held = await this.lock() },
      commit: () => this.commit(writes, held!),
      rollback: () => {},
      end: () => held?.release(),
    })
  }

  /** Its transactions run one at a time: a key is guarded by being in one. */
  guard(keys: string[]): Promise<void> {
    return this.scope.guard(keys)
  }

  afterCommit(fn: () => void): void {
    this.scope.afterCommit(fn)
  }

  afterRollback(fn: () => void): void {
    this.scope.afterRollback(fn)
  }

  async close(): Promise<void> {
    await this.scope.drain()
  }

  /** A record, as the transaction in progress sees it; outside one, as committed. An id no record can have finds none. */
  async load(collection: string, id: string): Promise<FileRecord | undefined> {
    if (!ID.test(id)) return undefined
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
    if (!ID.test(id)) throw new Error(`A record's id is made of up to 100 letters, numbers, '.', '-' and '_', starting with a letter or a number: '${id}' is not`)
    return this.transaction(() => {
      const writes = this.scope.state!
      const staged = writes.get(collection) ?? new Map<string, FileRecord | null>()
      staged.set(id, record ? structuredClone(record) : null)
      writes.set(collection, staged)
    })
  }

  /**
   * Runs `fn` once the other calls of the transaction in progress that went through
   * here ended: a table's check and the write it allows are not split by another
   * check of the same transaction (two inserts awaited together).
   */
  serially<T>(fn: () => Promise<T>): Promise<T> {
    const writes = this.scope.state
    if (!writes) return fn()
    const result = (turns.get(writes) ?? Promise.resolve()).then(fn)
    turns.set(writes, result.catch(() => {}))
    return result
  }

  /** Inside a transaction it holds the lock already; outside, a read takes it for itself. */
  private reading<T>(fn: () => Promise<T>): Promise<T> {
    this.scope.assertNotEnded()
    if (this.scope.inTransaction) return fn()
    return this.scope.exclusive(async () => {
      const held = await this.lock()
      try {
        return await fn()
      } finally {
        await held.release()
      }
    })
  }

  /** Takes the lock, and finishes a journal whoever held it last left behind. */
  private async lock(): Promise<Lock> {
    const held = await lock(join(this.folder, LOCK))
    try {
      const journal = await readIfAny(join(this.folder, JOURNAL))
      // A journal cut short was never committed: the rename that commits writes it whole.
      if (journal !== undefined) await this.finish(JSON.parse(journal) as JournalEntry[], held)
    } catch (error) {
      await held.release()
      throw error
    }
    return held
  }

  /**
   * Commits through the journal. Once the journal is on the disk the transaction is
   * committed: if writing the records fails, the next one to take the lock writes
   * them, so this one is not told it failed.
   *
   * The journal goes in only if the lock is still this transaction's: one taken over
   * while its process was stopped (its reads may be stale) fails with a
   * `ConcurrencyConflict`, writing nothing; so does one that only read, whose reads
   * may mix two transactions. Losing the lock after the journal is in leaves its
   * records to the new holder, which finishes the journal first.
   */
  private async commit(writes: Writes, held: Lock): Promise<void> {
    const entries: JournalEntry[] = [...writes].flatMap(([collection, records]) => [...records].map(([id, record]) => ({ collection, id, record })))
    if (entries.length === 0) return held.fenced(() => {})
    await writeAtomically(join(this.folder, JOURNAL), JSON.stringify(entries), held.fenced)
    try {
      await this.apply(entries, held)
    } catch (error) {
      if (error instanceof ConcurrencyConflict) return
      console.error('[files] a commit is in the journal but its records could not be written yet; the next lock writes them:', error)
    }
  }

  /**
   * Finishes a journal left behind. Until it is, nothing else runs: it is a committed
   * transaction, and what is read meanwhile would miss it. So when the disk refuses it
   * (no space, no permission, a folder where a record goes) every call fails, saying
   * so, until that is mended. An entry no store could ever write (one from a version
   * without the limits on names) is put aside in a file of its own instead.
   */
  private async finish(entries: JournalEntry[], held: Lock): Promise<void> {
    const unwritable = entries.filter(({ collection, id }) => !NAME.test(collection) || !ID.test(id))
    const rest = entries.filter(entry => !unwritable.includes(entry))
    if (unwritable.length > 0) {
      const aside = join(this.folder, `_journal.${Bun.randomUUIDv7()}.unwritable.json`)
      await writeAtomically(aside, JSON.stringify(unwritable))
      await writeAtomically(join(this.folder, JOURNAL), JSON.stringify(rest), held.fenced)
      console.error(`[files] a journal left behind has records no file can be named for; they are in ${aside}, the rest is written`)
    }
    try {
      await this.apply(rest, held)
    } catch (error) {
      if (error instanceof ConcurrencyConflict) throw error
      throw new Error(`The store cannot finish the commit in ${join(this.folder, JOURNAL)}, and waits for it: ${String(error)}`, { cause: error })
    }
  }

  /** Each write holding the lock still: one taken over stops it, to the new holder. */
  private async apply(entries: JournalEntry[], held: Lock): Promise<void> {
    for (const { collection, id, record } of entries) {
      const path = this.path(collection, id)
      if (record) await writeAtomically(path, JSON.stringify(record, null, 2), held.fenced)
      else held.fenced(() => removeIfAnySync(path))
    }
    held.fenced(() => removeIfAnySync(join(this.folder, JOURNAL)))
  }

  private async readRecord(collection: string, id: string): Promise<FileRecord | undefined> {
    const text = await readIfAny(this.path(collection, id))
    return text === undefined ? undefined : JSON.parse(text) as FileRecord
  }

  private path(collection: string, id: string): string {
    return join(this.folder, collection, `${id}.json`)
  }
}

function removeIfAnySync(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}
