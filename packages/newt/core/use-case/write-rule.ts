/**
 * What happens when a use case writes to another module outside a worker: an error
 * (`error`, the default), a warning once for each pair of modules (`warn`, while an
 * application moves to the rule), or nothing (`off`).
 */
export type WriteRule = 'off' | 'warn' | 'error'
