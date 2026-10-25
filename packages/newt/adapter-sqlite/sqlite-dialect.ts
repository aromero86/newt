import type { SqlDialect } from '../adapter-sql'
import { isCollision } from './is-collision'

/** SQLite's SQL: `?` parameters, booleans as 0 and 1, and its `lower()`, which folds A to Z only. */
export const sqliteDialect: SqlDialect = {
  param: () => '?',
  quote: identifier => `"${identifier.replaceAll('"', '""')}"`,
  always: '1',
  never: '0',
  distinct: (column, param) => `${column} IS NOT ${param}`,
  ieq: (column, next) => `lower(${column}) = lower(${next()})`,
  boolean: value => (value ? 1 : 0),
  isCollision,
  // Its transactions run one at a time: none is ever given up for another.
  isConflict: () => false,
}
