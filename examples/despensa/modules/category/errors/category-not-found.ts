import { NotFoundError } from 'newt/core'

export class CategoryNotFound extends NotFoundError {
  readonly code = 'category.not_found'
  constructor(id: string) {
    super(`There is no category ${id}`)
  }
}
