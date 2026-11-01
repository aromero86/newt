import { NotFoundError } from 'newt-kit/core'

export class AppNotFound extends NotFoundError {
  readonly code = 'app.not_found'
  constructor(id: string) {
    super(`There is no application ${id}`)
  }
}
