// What other pieces of newt need from sql and applications must not reach: this file
// is not a subpath of the package. Each export says which piece uses it.

/** Kysely writes criteria as the stores do. */
export { whereClause } from './where-clause'
