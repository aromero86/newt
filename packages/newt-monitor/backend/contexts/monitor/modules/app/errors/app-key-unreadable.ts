import { ValidationError } from 'newt-kit/core'

/**
 * A new address for an application whose kept key no longer opens (sealed with another
 * secret): it cannot be checked with that key, so the key is asked for with it.
 */
export class AppKeyUnreadable extends ValidationError {
  readonly code = 'app.key_unreadable'
  constructor(name: string) {
    super(`The key kept for ${name} no longer opens: send its key with the new address`)
  }
}
