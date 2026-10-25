import { message } from '../messages/message'
import { ConflictError } from './conflict-error'

/**
 * Someone else saved the entity between reading it and saving it: its version is no
 * longer the one read. A use case marked `retryOnConflict` runs again on its own.
 */
export class ConcurrencyConflict extends ConflictError {
  readonly code = 'concurrency_conflict'
  constructor() {
    super(message('concurrency_conflict'))
  }
}
