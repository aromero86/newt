import type { FileStore } from './file-store'

/**
 * A change to a files store's records: there is no structure to change, only records
 * to transform (a field added, renamed, filled in). It runs in a transaction, with
 * the store's collections, and `down` undoes what `up` did.
 *
 * ```ts
 * { version: 2, name: 'product-archived', up: async store => {
 *   const products = store.collection('product')
 *   for (const product of await products.all()) await products.put({ ...product, archived: false })
 * }, down: async store => { … } }
 * ```
 */
export type FileMigration = {
  version: number
  name: string
  up(store: FileStore): Promise<void>
  down(store: FileStore): Promise<void>
}
