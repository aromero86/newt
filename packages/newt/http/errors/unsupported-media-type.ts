import { DomainError } from '../../core'
import { message } from '../../core/internal'

/**
 * A body read as JSON that does not say it is (`Content-Type: application/json`). A
 * form posted from another site cannot send that type without asking first (CORS).
 */
export class UnsupportedMediaType extends DomainError {
  readonly status = 415
  readonly code = 'unsupported_media_type'
  constructor() {
    super(message('unsupported_media_type'))
  }
}
