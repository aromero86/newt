import { defineScope } from '../core'

/**
 * Whether the call to `transaction` coming in is all or none, as a repository's save
 * is: joined to a transaction in progress and failing, it may have written half of
 * what it meant to, so it spoils that transaction, which then can only roll back. A
 * write of a table on its own is not: failing, it wrote nothing, and fails alone.
 * `TransactionScope` reads it as a call comes in, and clears it for what runs inside.
 */
export const allOrNone = defineScope<boolean>('all or none', { counted: false })
