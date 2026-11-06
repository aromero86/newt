import type { PrivateFiles, PublicFiles } from './files'
import type { PublicStorageAdapter, StorageAdapter } from './storage-adapter'

/** Where a context keeps its files: either kind, in the same place or apart. */
export type StorageOptions = {
  private?: StorageAdapter
  public?: PublicStorageAdapter
}

/** A context's files, as its modules reach them (`base.storage`), each kind under the context's name. */
export type ContextStorage = {
  readonly private: PrivateFiles
  readonly public: PublicFiles
}
