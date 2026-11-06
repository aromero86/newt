import { ConflictError } from '@newt-kit/newt/core'
import { MAX_ATTACHMENTS } from '../attachment.schema'

export class TooManyAttachments extends ConflictError {
  readonly code = 'attachment.too_many'
  constructor() {
    super(`A card has ${MAX_ATTACHMENTS} files at most`)
  }
}
