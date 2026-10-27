import { defineScope } from '../core'

/**
 * The save in progress (a repository's `save` or `saveRows`), which the tables tell
 * what they read (`noteRead`): whether it guards anything, and the tables it read.
 */
export const saveReads = defineScope<{ guarded: boolean, tables: Set<string> }>('save', { counted: false })
