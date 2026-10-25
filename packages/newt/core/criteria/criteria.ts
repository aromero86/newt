import type { Condition } from './condition'

/**
 * What a row must be like. Field by field, all of them at once: a field set to a
 * value must equal it (`null` is "has none"); set to a condition, it must pass every
 * operator in it. A field left `undefined` is no condition at all, so a filter that
 * was not given needs no `if`. Groups nest: `and`, every one of them; `or`, at least one.
 *
 * ```ts
 * { workspaceId, archived: false, or: [{ priceCents: { lt: 500 } }, { brandId: 'acme' }] }
 * ```
 *
 * Every store understands it: SQLite turns it into a `WHERE`, the files store checks
 * each row with `matches`. A row cannot have fields named `and` or `or`. Conditions on
 * a field that holds an object or a list are not part of it: a repository asks those
 * through its store.
 */
export type Criteria<Row> = { [K in keyof Row]?: Row[K] | Condition<Row[K]> } & {
  and?: readonly Criteria<Row>[]
  or?: readonly Criteria<Row>[]
}
