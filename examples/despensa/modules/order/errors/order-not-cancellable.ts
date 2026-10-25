import { ConflictError } from 'newt/core'

export class OrderNotCancellable extends ConflictError {
  readonly code = 'order.not_cancellable'
  constructor(id: string) {
    super(`The order ${id} was rejected: there is nothing to cancel`)
  }
}
