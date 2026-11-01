import { NotFoundError } from 'newt-kit/core'

export class ProductNotFound extends NotFoundError {
  readonly code = 'product.not_found'
  constructor(id: string) {
    super(`There is no product ${id}`)
  }
}
