/**
 * The changes to a store's structure, applied in order and remembered by the store:
 * SQL scripts for SQLite, functions that transform records for the files adapter.
 * Each one is named `<version>_<name>`, the version zero-padded (`00003_product-code`).
 */
export interface Migrations {
  /** Applies every pending one, all of them or none; the ones it applied. */
  up(): Promise<string[]>
  /** Reverts the last one applied; the one it reverted, if any. */
  down(): Promise<string | null>
  status(): Promise<{ applied: string[], pending: string[] }>
}
