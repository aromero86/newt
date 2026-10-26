import { NotFoundError } from 'newt/core'

export class JobNotFound extends NotFoundError {
  readonly code = 'outbox.job_not_found'
  constructor(id: string) {
    super(`There is no job ${id}`)
  }
}
