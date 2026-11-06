import { NotFoundError } from '@newt-kit/newt/core'

export class AttachmentNotFound extends NotFoundError {
  readonly code = 'attachment.not_found'
  constructor(id: string) {
    super(`There is no attachment ${id}`)
  }
}
