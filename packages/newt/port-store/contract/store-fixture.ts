import type { Store } from '../../port-store'

/**
 * How the suite gets stores of an adapter: each `open` is a fresh, empty store, which
 * the suite closes. A store whose structure is declared ahead (SQLite) has a `thing`
 * table for `ThingRow`, every field a column in snake case, and `name` unique among
 * the rows whose `deleted_at` is null. Its text columns sort by code point: `COLLATE "C"`
 * on Postgres, `utf8mb4_0900_bin` on MySQL.
 */
export type StoreFixture<S extends Store = Store> = {
  open(): Promise<S>
}
