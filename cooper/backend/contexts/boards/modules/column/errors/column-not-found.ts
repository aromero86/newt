import { NotFoundError } from 'newt-kit/core'

export class ColumnNotFound extends NotFoundError {
  readonly code = 'column.not_found'
  constructor(id: string) {
    super(`There is no column ${id}`)
  }
}
