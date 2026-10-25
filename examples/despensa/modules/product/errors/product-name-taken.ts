import { ConflictError } from 'newt/core'

export class ProductNameTaken extends ConflictError {
  readonly code = 'product.name_taken'
  constructor(name: string) {
    super(`There is a product called ${name} already`)
  }
}
