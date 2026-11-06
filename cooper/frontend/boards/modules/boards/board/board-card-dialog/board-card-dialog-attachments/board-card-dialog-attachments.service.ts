import { AttachmentApi, type AttachmentDTO } from '@cooper/api/attachment'
import type { CardDTO } from '@cooper/api/card'
import { uploadFile } from '@cooper/api/upload-file'
import { ApiError, inject, Store } from '@newt-kit/react'
import { BoardService } from '../../board.service'

const messageOf = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong')

/**
 * The files of the card opened. Attaching one is three steps: asking where to send it,
 * sending it there, not through the API, and asking the API to look at what came.
 */
export class BoardCardDialogAttachmentsService {

  private readonly api = inject(AttachmentApi)
  private readonly board = inject(BoardService)
  private readonly store = new Store({ items: [] as AttachmentDTO[], loaded: false, uploading: false, failure: null as string | null })
  private cardId = ''

  readonly items = this.store.select('items')
  readonly loaded = this.store.select('loaded')
  readonly uploading = this.store.select('uploading')
  readonly failure = this.store.select('failure')

  /** Reads this card's files, unless they are shown already. */
  async show(card: CardDTO): Promise<void> {
    if (this.cardId === card.id) return
    this.cardId = card.id
    this.store.patch({ items: [], loaded: false, failure: null })
    await this.attempt(async () => {
      this.store.patch({ items: await this.api.listForCard(this.board.workspaceId, card.id), loaded: true })
    })
  }

  async attach(file: File): Promise<void> {
    this.store.patch({ uploading: true, failure: null })
    await this.attempt(async () => {
      const { attachment, uploadUrl } = await this.api.uploadStart(this.board.workspaceId, this.cardId, {
        filename: file.name,
        // A browser may not know the type: the API refuses what it does not take.
        contentType: file.type as AttachmentDTO['contentType'],
        sizeBytes: file.size,
      })
      await uploadFile(uploadUrl, file)
      const confirmed = await this.api.uploadConfirm(this.board.workspaceId, attachment.id)
      this.store.patch({ items: [...this.store.value.items, confirmed] })
    })
    this.store.patch({ uploading: false })
  }

  async remove(attachment: AttachmentDTO): Promise<void> {
    await this.attempt(async () => {
      await this.api.remove(this.board.workspaceId, attachment.id)
      this.store.patch({ items: this.store.value.items.filter(each => each.id !== attachment.id) })
    })
  }

  downloadAddress(attachment: AttachmentDTO): string {
    return this.api.downloadAddress(this.board.workspaceId, attachment.id)
  }

  private async attempt(work: () => Promise<void>): Promise<void> {
    try {
      await work()
    } catch (error) {
      this.store.patch({ failure: messageOf(error), loaded: true })
    }
  }
}
