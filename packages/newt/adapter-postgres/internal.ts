// What other pieces of newt need from adapter-postgres and applications must not reach:
// this file is not a subpath of the package. Each export says which piece uses it.

/** Kysely writes criteria in its dialect. */
export { postgresDialect } from './postgres-dialect'
