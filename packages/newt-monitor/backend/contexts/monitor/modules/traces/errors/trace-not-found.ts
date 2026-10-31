import { NotFoundError } from 'newt/core'

export class TraceNotFound extends NotFoundError {
  readonly code = 'trace.not_found'
  constructor(id: string) {
    super(`There is no trace ${id}: it was not kept, or it is forgotten`)
  }
}
