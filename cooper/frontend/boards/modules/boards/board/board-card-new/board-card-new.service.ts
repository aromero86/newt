import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { BoardService } from '../board.service'
import { CardFormSchema } from '../board-card-form'

/** A new card at the bottom of a column. */
export class BoardCardNewService {

  private readonly board = inject(BoardService)
  private columnId = ''

  readonly form = new FormStore(CardFormSchema, { title: '', description: '' }, {
    errorFields: { validation: 'title' },
  })

  start(columnId: string): void {
    this.columnId = columnId
    this.form.reset({ title: '', description: '' })
  }

  /** Resolves to whether it was created. */
  submit(): Promise<boolean> {
    return this.form.submit(async input => {
      await this.board.createCard({ ...input, columnId: this.columnId })
    })
  }
}
