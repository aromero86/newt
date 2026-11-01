import { FormStore, inject } from 'newt-kit-react'
import { BoardService } from '../board.service'
import { CARD_FORM_MESSAGES, CardFormSchema } from '../board-card-form'

/** A new card at the bottom of a column. */
export class BoardCardNewService {

  private readonly board = inject(BoardService)
  private columnId = ''
  /**
   * One `Idempotency-Key` per card being made: a submit again after a failure (its
   * answer lost on the way) sends the same one, and gets the card the first one made.
   */
  private key = crypto.randomUUID()
  /** What the key was last sent with: the backend refuses it with another body. */
  private sent: string | null = null

  readonly form = new FormStore(CardFormSchema, { title: '', description: '' }, {
    errorFields: { validation: 'title' },
    messages: CARD_FORM_MESSAGES,
  })

  start(columnId: string): void {
    this.columnId = columnId
    this.newKey()
    this.form.reset({ title: '', description: '' })
  }

  /** Resolves to whether it was created. */
  submit(): Promise<boolean> {
    return this.form.submit(async input => {
      const card = { ...input, columnId: this.columnId }
      const body = JSON.stringify(card)
      if (this.sent !== null && this.sent !== body) this.newKey()
      this.sent = body
      await this.board.createCard(card, this.key)
      this.newKey()
    })
  }

  private newKey(): void {
    this.key = crypto.randomUUID()
    this.sent = null
  }
}
