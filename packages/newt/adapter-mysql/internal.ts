// What other pieces of newt need from adapter-mysql and applications must not reach:
// this file is not a subpath of the package. Each export says which piece uses it.

/** Kysely writes criteria in its dialect. */
export { mysqlDialect } from './mysql-dialect'
