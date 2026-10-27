import { ColumnAddSchema, type ColumnDTO } from '@cooper/api/column'
import { FormStore, inject } from 'newt-react'
import { BoardService } from '../board.service'

/** A column's name: a new column at the end of the board, or a new name for one. */
export class BoardColumnFormService {

  private readonly board = inject(BoardService)
  private column: ColumnDTO | null = null

  readonly form = new FormStore(ColumnAddSchema, { name: '' }, {
    errorFields: { 'column.too_many': 'name', validation: 'name' },
  })

  /** Starts with this column's name, or empty for a new one. */
  start(column: ColumnDTO | null): void {
    this.column = column
    this.form.reset({ name: column?.name ?? '' })
  }

  /** Resolves to whether it was saved. */
  submit(): Promise<boolean> {
    const column = this.column
    return this.form.submit(({ name }) => column ? this.board.renameColumn(column, name) : this.board.addColumn(name))
  }
}
