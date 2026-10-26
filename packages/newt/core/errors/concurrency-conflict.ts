import { message } from '../messages/message'
import { ConflictError } from './conflict-error'

/**
 * Someone else saved the entity between reading it and saving it: its version is no
 * longer the one read. A use case runs again on its own, unless it says `retryOnConflict: false`.
 * A value another one took first is one of its own: `DuplicateValue`.
 */
export class ConcurrencyConflict extends ConflictError {
  readonly code: string = 'concurrency_conflict'
  constructor() {
    super(message('concurrency_conflict'))
  }
}
