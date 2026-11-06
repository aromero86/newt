import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { AttachmentDTO } from '../attachment.schema'

/** What was uploaded was not what the client said. */
export class Attachment_Refused implements DomainEvent<AttachmentDTO> {
  static readonly eventName = 'attachment.refused'
  readonly name = Attachment_Refused.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AttachmentDTO) {}
}
