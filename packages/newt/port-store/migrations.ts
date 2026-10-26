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
  /**
   * What is applied and what is pending, in order; and `changed`, the applied ones
   * whose script was changed since they were applied (which `up`, and opening the
   * store, refuse). A store whose migrations are code, not files, has none.
   */
  status(): Promise<MigrationStatus>
}

/** What `Migrations.status` tells: every name is `<version>_<name>`. */
export type MigrationStatus = { applied: string[], pending: string[], changed: string[] }
