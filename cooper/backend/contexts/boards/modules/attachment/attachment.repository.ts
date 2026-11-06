import { TableRepository } from '@newt-kit/newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Attachment, MAX_ATTACHMENTS, type AttachmentDTO } from './attachment'
import { TooManyAttachments } from './errors/too-many-attachments'

export type AttachmentRow = AttachmentDTO & { version: number }

export class Attachment_Repository extends TableRepository<Attachment, AttachmentRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<AttachmentRow>('attachment'), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: AttachmentRow): Attachment {
    return Attachment.fromDTO(row)
  }

  /** A new one, only if its card is left with no more than `MAX_ATTACHMENTS`. */
  async persistWithRoom(attachment: Attachment): Promise<void> {
    const { cardId } = attachment
    await this.save([attachment], each => this.write(each), {
      guard: [`attachments:${cardId}`],
      after: async () => {
        if (await this.count({ cardId }) > MAX_ATTACHMENTS) throw new TooManyAttachments()
      },
    })
  }

  /** Uploads started before `before` and never finished, of any workspace: for the sweep, which enters each. */
  pendingInEveryScopeSince(before: string, limit: number): Promise<Attachment[]> {
    return this.findInEveryScope({ status: 'pending', createdAt: { lt: before } }, { limit })
  }
}
