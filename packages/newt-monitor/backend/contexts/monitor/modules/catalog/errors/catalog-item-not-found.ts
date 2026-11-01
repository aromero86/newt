import { NotFoundError } from '@newt-kit/newt/core'

export class CatalogItemNotFound extends NotFoundError {
  readonly code = 'catalog.item_not_found'
  constructor(id: string) {
    super(`There is no catalog item ${id}`)
  }
}
