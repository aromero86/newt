import { ConflictError } from 'newt/core'

export class NotEnoughStock extends ConflictError {
  readonly code = 'stockMovement.not_enough_stock'
  constructor(productId: string) {
    super(`There is not enough stock of ${productId}`)
  }
}
