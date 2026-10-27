import { defineScope } from '../core'

/**
 * The modules the saves of the transaction in progress wrote to, as
 * `<context>.<module>`: `TransactionScope` gives each transaction its own, empty, and
 * a repository's save adds its module to it, which the write rule checks.
 */
export const transactionSaves = defineScope<Set<string>>('transaction saves', { counted: false })
