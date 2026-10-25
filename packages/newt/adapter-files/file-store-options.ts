import type { FileMigration } from './file-migration'

export type FileStoreOptions = {
  /** The folder it keeps everything in: made if there is none. */
  folder: string
  /** The changes to its records, in order. */
  migrations?: FileMigration[]
  /** How long a call waits for the store, behind what holds it, before it gives up: 30 s by default. */
  waitTimeoutMs?: number
}
