import { Entity, type EntityInput } from '@newt-kit/newt/core'
import { AttachmentSchema, type AttachmentDTO } from './attachment.schema'
import { Attachment_Refused } from './events/attachment-refused'
import { Attachment_Removed } from './events/attachment-removed'

export * from './attachment.schema'

/** A file of a card: its bytes are in the storage, under its id. */
export class Attachment extends Entity<typeof AttachmentSchema> {

  private constructor(input: EntityInput<AttachmentDTO>, isNew: boolean) {
    super(AttachmentSchema, input, isNew)
  }

  static fromDTO(dto: AttachmentDTO & { version: number }): Attachment {
    return new Attachment(dto, false)
  }

  /** Someone is about to upload it. */
  static start(input: Pick<AttachmentDTO, 'workspaceId' | 'cardId' | 'filename' | 'contentType' | 'sizeBytes'>): Attachment {
    return new Attachment({ ...input, status: 'pending' }, true)
  }

  get cardId(): string {
    return this.data.cardId
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get filename(): string {
    return this.data.filename
  }

  get contentType(): AttachmentDTO['contentType'] {
    return this.data.contentType
  }

  get isReady(): boolean {
    return this.data.status === 'ready'
  }

  /** What came is what it said, this long. */
  markReady(sizeBytes: number): void {
    this.change({ status: 'ready', sizeBytes })
  }

  /** What came is not what it said: it goes, and a worker deletes its bytes. */
  refuse(): void {
    this.markAsDeleted()
    this.trackEvent(new Attachment_Refused(this.toDTO()))
  }

  /** It goes, and a worker deletes its bytes. */
  remove(): void {
    this.markAsDeleted()
    this.trackEvent(new Attachment_Removed(this.toDTO()))
  }
}
