import { NotFoundError } from 'newt/core'

export class ProductNotFound extends NotFoundError {
  readonly code = 'product.not_found'
  constructor(id: string) {
    super(`There is no product ${id}`)
  }
}
