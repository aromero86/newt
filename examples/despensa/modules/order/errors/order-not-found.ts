import { NotFoundError } from 'newt/core'

export class OrderNotFound extends NotFoundError {
  readonly code = 'order.not_found'
  constructor(id: string) {
    super(`There is no order ${id}`)
  }
}
