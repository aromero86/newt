import { NotFoundError } from 'newt/core'

export class BrandNotFound extends NotFoundError {
  readonly code = 'brand.not_found'
  constructor(id: string) {
    super(`There is no brand ${id}`)
  }
}
