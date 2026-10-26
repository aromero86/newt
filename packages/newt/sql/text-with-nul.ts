import { ValidationError } from '../core'
import { message } from '../core/internal'

/** A value with the NUL character, which a store whose text cannot hold it (Postgres) refuses: a 400. */
export class TextWithNul extends ValidationError {
  readonly code = 'validation'
  constructor() {
    super(message('validation'))
  }
}
