import type { CardDTO } from '@cooper/api/card'
import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'
import { toast } from '@cooper/ui/components/toast'
import { BoardService } from '../board.service'
import { CardFormSchema } from '../board-card-form'

/** One card, opened: editing its title and description, and deleting it after asking. */
export class BoardCardDialogService {

  private readonly board = inject(BoardService)
  private readonly store = new Store({ confirmingDelete: false, deleting: false })
  private cardId = ''

  readonly confirmingDelete = this.store.select('confirmingDelete')
  readonly deleting = this.store.select('deleting')

  readonly form = new FormStore(CardFormSchema, { title: '', description: '' }, {
    errorFields: { validation: 'title' },
  })

  /** Starts editing this card, unless it is the one being edited already. */
  edit(card: CardDTO): void {
    if (this.cardId === card.id) return
    this.cardId = card.id
    this.form.reset({ title: card.title, description: card.description })
    this.store.patch({ confirmingDelete: false })
  }

  async save(card: CardDTO): Promise<void> {
    if (await this.form.submit(input => this.board.editCard(card, input))) toast.success(`#${card.number} is saved`)
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
