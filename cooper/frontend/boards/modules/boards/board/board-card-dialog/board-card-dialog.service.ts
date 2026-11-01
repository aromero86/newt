import type { CardDTO } from '@cooper/api/card'
import { FormStore, inject, Store } from 'newt-kit-react'
import { toast } from 'newt-kit-react-ui/toast'
import { BoardService } from '../board.service'
import { CARD_FORM_MESSAGES, CARD_NOBODY, CardDialogFormSchema } from '../board-card-form'

/**
 * One card, opened: its title, description, column and assignee, edited together and
 * saved with one Save; and deleting it after asking.
 */
export class BoardCardDialogService {

  private readonly board = inject(BoardService)
  private readonly store = new Store({ confirmingDelete: false, deleting: false })
  private cardId = ''

  readonly confirmingDelete = this.store.select('confirmingDelete')
  readonly deleting = this.store.select('deleting')

  readonly form = new FormStore(CardDialogFormSchema, { title: '', description: '', columnId: '', assigneeId: CARD_NOBODY }, {
    errorFields: { validation: 'title' },
    messages: CARD_FORM_MESSAGES,
  })

  /** Starts editing this card, unless it is the one being edited already. */
  edit(card: CardDTO): void {
    if (this.cardId === card.id) return
    this.cardId = card.id
    this.form.reset({ title: card.title, description: card.description, columnId: card.columnId, assigneeId: card.assigneeId ?? CARD_NOBODY })
    this.store.patch({ confirmingDelete: false })
  }

  /** Saves whatever changed. Resolves to whether it was saved. */
  async save(card: CardDTO): Promise<boolean> {
    const saved = await this.form.submit(({ assigneeId, ...input }) => this.board.updateCard(card, { ...input, assigneeId: assigneeId === CARD_NOBODY ? null : assigneeId }))
    if (saved) toast.success(`#${card.number} is saved`)
    return saved
  }

  askDelete(): void {
    this.store.patch({ confirmingDelete: true })
  }

  cancelDelete(): void {
    this.store.patch({ confirmingDelete: false })
  }

  /** Resolves to whether it is gone. */
  async delete(card: CardDTO): Promise<boolean> {
    this.store.patch({ deleting: true })
    try {
      return await this.board.deleteCard(card)
    } finally {
      this.store.patch({ deleting: false, confirmingDelete: false })
    }
  }
}
