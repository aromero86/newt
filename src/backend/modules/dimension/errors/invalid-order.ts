import { ValidationError } from '../../../core/errors/validation-error'

export class InvalidOrder extends ValidationError {
  readonly code = 'dimension.invalid_order'
  constructor() {
    super('The new order must list every item once, and only them')
  }
}
