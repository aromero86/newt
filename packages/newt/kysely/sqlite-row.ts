import type { SqlBool } from 'kysely'

/**
 * A row as SQLite gives it back to a query of one's own: a boolean as 0 or 1, an
 * object or a list as its JSON text. The `Row` a table repository declares, for the
 * database type Kysely is given:
 *
 * ```ts
 * type ShopDatabase = { product: SqliteRow<ProductRow>, stock_movement: SqliteRow<StockMovementRow> }
 * ```
 */
export type SqliteRow<Row> = {
  [K in keyof Row]: Row[K] extends boolean ? SqlBool : Row[K] extends boolean | null ? SqlBool | null : Row[K] extends object ? string : Row[K]
}
