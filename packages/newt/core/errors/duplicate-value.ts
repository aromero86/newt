import { message } from '../messages/message'
import { ConcurrencyConflict } from './concurrency-conflict'

/**
 * A save gives a row a value no two rows share (a unique index, a table's `unique`)
 * that another one took first. A use case runs again on it only once: its own check
 * (an email taken) then finds that row, and answers with its own error. `fields`
 * names the ones that collided when the store can tell, and is empty otherwise.
 */
export class DuplicateValue extends ConcurrencyConflict {
  override readonly code = 'duplicate_value'
  constructor(readonly fields: string[] = []) {
    super()
    this.message = message('duplicate_value', { fields })
  }
}
