import { DomainError } from '../core'
import { message } from '../core/internal'

/** A client asked to upload a file longer than it may be: a 413, before any address is signed. */
export class UploadTooLarge extends DomainError {
  readonly status = 413
  readonly code = 'upload_too_large'
  constructor(readonly maxBytes: number) {
    super(message('upload_too_large', { maxBytes }))
  }
}
