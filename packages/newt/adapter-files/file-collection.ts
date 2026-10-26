import type { FileStore } from './file-store'
import type { FileRecord } from './file-record'

/**
 * The records of one collection, as they are: what a table is built on, and what a
 * migration or a report uses for what a table cannot say. Reads see the transaction
 * in progress; writes join it, or run in one of their own.
 */
export class FileCollection {

  constructor(readonly store: FileStore, readonly name: string) {}

  get(id: string): Promise<FileRecord | undefined> {
    return this.store.load(this.name, id)
  }

  all(): Promise<FileRecord[]> {
    return this.store.loadAll(this.name)
  }

  /** Writes it whole, over the one with its id if there is one. */
  put(record: FileRecord): Promise<void> {
    return this.store.stage(this.name, record.id, record)
  }

  remove(id: string): Promise<void> {
    return this.store.stage(this.name, id, null)
  }
}
