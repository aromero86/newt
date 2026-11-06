import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { AttachmentDTO } from '../attachment.schema'

/** It is gone: someone removed it, its card went, or its upload never finished. */
export class Attachment_Removed implements DomainEvent<AttachmentDTO> {
  static readonly eventName = 'attachment.removed'
  readonly name = Attachment_Removed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AttachmentDTO) {}
}
