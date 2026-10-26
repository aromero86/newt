import { z } from 'zod'
import { BoardApi, type BoardDTO } from '@cooper/api/board'
import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { ListStore } from '@cooper/core/list/list-store'
import { Store } from '@cooper/core/store/store'
import { toast } from '@cooper/ui/components/toast'

// The backend's board schema brings its value objects and newt along with it, so the
// form repeats its limits; the backend checks them again.
const BoardFormSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(60, 'Keep it under 60 characters'),
  description: z.string().trim().max(500, 'Keep it under 500 characters'),
})

type BoardsListState = {
  /** The dialog to create a board is open. */
  creating: boolean
  /** The board someone asked to archive, waiting for them to confirm. */
  archiving: BoardDTO | null
  archivingBusy: boolean
}

/** A workspace's boards, the newest first and page by page: creating and archiving them. */
export class BoardsListService {

  private readonly api = inject(BoardApi)
  private readonly store = new Store<BoardsListState>({ creating: false, archiving: null, archivingBusy: false })
  private workspaceId = ''

  readonly list = new ListStore<BoardDTO>(page => this.api.list(this.workspaceId, page))
  readonly creating = this.store.select('creating')
  readonly archiving = this.store.select('archiving')
  readonly archivingBusy = this.store.select('archivingBusy')

  readonly form = new FormStore(BoardFormSchema, { name: '', description: '' }, {
    errorFields: { 'board.name_taken': 'name', 'board.invalid_name': 'name' },
  })

  async load(workspaceId: string): Promise<void> {
    this.workspaceId = workspaceId
    await this.list.loadFirstPage()
  }

  startCreate(): void {
    this.form.reset({ name: '', description: '' })
    this.store.patch({ creating: true })
  }

  closeCreate(): void {
    this.store.patch({ creating: false })
  }

  /** Resolves to the new board, or `null` when it could not be created. */
  async create(): Promise<BoardDTO | null> {
    let created: BoardDTO | null = null
    await this.form.submit(async input => {
      created = await this.api.create(this.workspaceId, input)
      this.list.prepend(created)
    })
    if (created) this.closeCreate()
    return created
  }

  askArchive(board: BoardDTO): void {
    this.store.patch({ archiving: board })
  }

  cancelArchive(): void {
    this.store.patch({ archiving: null })
  }

  async archive(): Promise<void> {
    const board = this.store.value.archiving
    if (!board) return
    this.store.patch({ archivingBusy: true })
    try {
      await this.api.archive(this.workspaceId, board.id)
      this.list.remove(board.id)
      this.store.patch({ archiving: null })
      toast.success(`${board.name} is archived`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      this.store.patch({ archivingBusy: false })
    }
  }
}
