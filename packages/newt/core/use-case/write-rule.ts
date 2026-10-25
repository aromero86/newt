/**
 * What happens when a use case writes to another module outside a worker: nothing
 * (`off`), a warning, once for each pair of modules (`warn`, the default), or an error
 * (`error`, for tests and development).
 */
export type WriteRule = 'off' | 'warn' | 'error'
