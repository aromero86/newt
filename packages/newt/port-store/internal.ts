// What other pieces of newt need from port-store and applications must not reach: this
// file is not a subpath of the package. Each export says which piece uses it.

/** A repository's save enters it, and checks what its tables read in it. */
export { saveReads } from './save-reads'

/** A repository's save enters it, so failing inside a transaction it joined, it spoils it. */
export { allOrNone } from './all-or-none'

/** A repository's save adds its module to it, and the write rule checks it holds one. */
export { transactionSaves } from './transaction-saves'
