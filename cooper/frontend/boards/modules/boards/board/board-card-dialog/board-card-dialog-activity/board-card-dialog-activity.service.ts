import { ActivityApi, type ActivityDTO } from '@cooper/api/activity'
import type { CardDTO } from '@cooper/api/card'
import { inject, ListStore } from 'newt-kit-react'
import { BoardService } from '../../board.service'

/**
 * The activity of the card opened: read page by page, the newest first, and read
 * again whenever the card changes. The backend writes it a moment after each change.
 */
export class BoardCardDialogActivityService {

  private readonly api = inject(ActivityApi)
  private readonly board = inject(BoardService)
  private shown: Pick<CardDTO, 'id' | 'updatedAt'> | null = null

  readonly list = new ListStore<ActivityDTO>(page => this.api.listForCard(this.board.workspaceId, this.shown?.id ?? '', page), 10)

  /** Reads this card's activity, unless it is shown as it is already. */
  show(card: CardDTO): void {
    if (this.shown?.id === card.id && this.shown.updatedAt === card.updatedAt) return
    this.shown = { id: card.id, updatedAt: card.updatedAt }
    void this.list.loadFirstPage()
  }
}
