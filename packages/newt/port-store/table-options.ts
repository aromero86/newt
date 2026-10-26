import type { FieldType } from './field-type'

/**
 * What a table needs said of its rows beyond their fields, in the same words for
 * every store, so a repository moves from one store to another unchanged. A store
 * that does not need something ignores it.
 */
export type TableOptions<Row> = {
  /** The fields a store may not keep as they are: SQLite keeps a boolean as 0 or 1, and JSON as text. */
  types?: Partial<Record<keyof Row & string, FieldType>>
  /**
   * The fields, alone or together, no two rows share, a row deleted softly (its
   * `deletedAt` set) aside: one that takes their value is a `DuplicateValue`. A
   * store whose structure says it already (SQLite's unique indexes) ignores it.
   */
  unique?: (keyof Row & string)[][]
}
