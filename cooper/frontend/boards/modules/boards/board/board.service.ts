import { computed } from '@preact/signals-core'
import { ApiError } from '@cooper/api/core/api-error'
import { BoardApi, type BoardViewDTO } from '@cooper/api/board'
import { CardApi, type CardCreateDTO, type CardDTO, type CardEditDTO } from '@cooper/api/card'
import { ColumnApi, type ColumnDTO } from '@cooper/api/column'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'
import { toast } from '@cooper/ui/components/toast'

type BoardState = {
  workspaceId: string
  boardId: string
  /** The board, its columns and their cards: `null` until it is read. */
  view: BoardViewDTO | null
  loading: boolean
  /** No such board in this workspace (or archived). */
  notFound: boolean
  failure: string | null
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

/**
 * One board as its screen shows it, and every change to its columns and cards. A
 * change that shifts the places of others (a move, a removal) reads the board again,
 * so what shows is what the backend keeps.
 */
export class BoardService {

  private readonly boardApi = inject(BoardApi)
  private readonly columnApi = inject(ColumnApi)
  private readonly cardApi = inject(CardApi)
  private readonly store = new Store<BoardState>({ workspaceId: '', boardId: '', view: null, loading: false, notFound: false, failure: null })

  private readonly view = this.store.select('view')
  readonly loading = this.store.select('loading')
  readonly notFound = this.store.select('notFound')
  readonly failure = this.store.select('failure')
  readonly board = computed(() => this.view.value?.board ?? null)
  /** From left to right. */
  readonly columns = computed(() => [...(this.view.value?.columns ?? [])].sort(byPosition))
  /** Each column's cards, from the top. */
  readonly cardsByColumn = computed(() => {
    const lanes = new Map<string, CardDTO[]>(this.columns.value.map(column => [column.id, []]))
    for (const card of [...(this.view.value?.cards ?? [])].sort(byPosition)) lanes.get(card.columnId)?.push(card)
    return lanes
  })
  readonly cardsById = computed(() => new Map((this.view.value?.cards ?? []).map(card => [card.id, card])))

  get workspaceId(): string {
    return this.store.value.workspaceId
  }

  async load(workspaceId: string, boardId: string): Promise<void> {
    this.store.patch({ workspaceId, boardId, view: null, loading: true, notFound: false, failure: null })
    await this.refresh()
    this.store.patch({ loading: false })
  }

  /** Reads the board again, keeping what shows until the new version arrives. */
  async refresh(): Promise<void> {
    const { workspaceId, boardId } = this.store.value
    try {
      const view = await this.boardApi.view(workspaceId, boardId)
      if (this.store.value.boardId === boardId) this.store.patch({ view, failure: null })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ notFound: true })
      else this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the board' })
    }
  }

  // Columns

  /** At the end of the board. Throws, for the form to show why. */
  async addColumn(name: string): Promise<void> {
    const column = await this.columnApi.add(this.workspaceId, this.store.value.boardId, { name })
    this.patchView(view => ({ columns: [...view.columns, column] }))
  }

  /** Throws, for the form to show why. */
  async renameColumn(column: ColumnDTO, name: string): Promise<void> {
    const renamed = await this.columnApi.rename(this.workspaceId, column.id, { name })
    this.patchView(view => ({ columns: view.columns.map(each => (each.id === renamed.id ? renamed : each)) }))
  }

  async moveColumn(column: ColumnDTO, position: number): Promise<void> {
    await this.attempt(() => this.columnApi.move(this.workspaceId, column.id, { position }))
  }

  /** Only an empty one. */
  async removeColumn(column: ColumnDTO): Promise<void> {
    await this.attempt(() => this.columnApi.remove(this.workspaceId, column.id), `${column.name} is removed`)
  }

  // Cards

  /** At the bottom of its column. Throws, for the form to show why. */
  async createCard(input: CardCreateDTO): Promise<CardDTO> {
    const card = await this.cardApi.create(this.workspaceId, this.store.value.boardId, input)
    this.patchView(view => ({ cards: [...view.cards, card] }))
    return card
  }

  /** Throws, for the form to show why. */
  async editCard(card: CardDTO, input: CardEditDTO): Promise<void> {
    this.replaceCard(await this.cardApi.edit(this.workspaceId, card.id, input))
  }

  /** To a column, at a position: at the bottom when none is given. */
  async moveCard(card: CardDTO, columnId: string, position?: number): Promise<void> {
    await this.attempt(() => this.cardApi.move(this.workspaceId, card.id, { columnId, position }))
  }

  /** To a member of the workspace, or to nobody with `null`. */
  async assignCard(card: CardDTO, assigneeId: string | null): Promise<void> {
    try {
      this.replaceCard(assigneeId
        ? await this.cardApi.assign(this.workspaceId, card.id, { assigneeId })
        : await this.cardApi.unassign(this.workspaceId, card.id))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  /** Resolves to whether it is gone. */
  async deleteCard(card: CardDTO): Promise<boolean> {
    return this.attempt(() => this.cardApi.remove(this.workspaceId, card.id), `#${card.number} is deleted`)
  }

  private replaceCard(card: CardDTO): void {
    this.patchView(view => ({ cards: view.cards.map(each => (each.id === card.id ? card : each)) }))
  }

  private patchView(change: (view: BoardViewDTO) => Partial<BoardViewDTO>): void {
    this.store.update(state => (state.view ? { view: { ...state.view, ...change(state.view) } } : {}))
  }

  /** Runs a change that moves others around, then reads the board again. Resolves to whether it worked. */
  private async attempt(action: () => Promise<unknown>, done?: string): Promise<boolean> {
    try {
      await action()
      if (done) toast.success(done)
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    } finally {
      await this.refresh()
    }
  }
}
