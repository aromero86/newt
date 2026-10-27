import { BoardApi, type BoardDTO } from '@cooper/api/board'
import { CardApi, type CardDTO, type CardFilterDTO, type CardSearchDTO } from '@cooper/api/card'
import { ColumnApi, type ColumnDTO } from '@cooper/api/column'
import { inject, ListStore, Store } from 'newt-react'

/** What the cards are searched by; an empty one leaves it out. */
export type SearchCriteria = {
  text: string
  boardId: string
  /** A column of the chosen board: columns are each board's. */
  columnId: string
  assigneeId: string
}

type SearchState = {
  criteria: SearchCriteria
  /** The boards to choose from, to narrow the search to one. */
  boards: BoardDTO[]
  /** The chosen board's columns. */
  columns: ColumnDTO[]
}

/** How many boards the board filter offers: the newest ones. */
const BOARD_CHOICES = 100

/** The workspace's cards, by words in their title or description, by board, column and assignee. */
export class SearchService {

  private readonly boardApi = inject(BoardApi)
  private readonly columnApi = inject(ColumnApi)
  private readonly cardApi = inject(CardApi)
  private readonly store = new Store<SearchState>({ criteria: { text: '', boardId: '', columnId: '', assigneeId: '' }, boards: [], columns: [] })
  private workspaceId = ''

  readonly boards = this.store.select('boards')
  readonly columns = this.store.select('columns')
  readonly results = new ListStore<CardDTO>(page => this.cardApi.search(this.workspaceId, this.input(), page))

  /** The boards to narrow the search to: once per workspace. The search itself starts with `search`. */
  async load(workspaceId: string): Promise<void> {
    this.workspaceId = workspaceId
    this.store.reset()
    await this.loadBoards()
  }

  /**
   * The cards that meet these criteria, all of them given: the page keeps them in its
   * address. Another board brings its columns.
   */
  async search(criteria: SearchCriteria): Promise<void> {
    const boardChanged = criteria.boardId !== this.store.value.criteria.boardId
    this.store.patch({ criteria, ...(boardChanged ? { columns: [] } : {}) })
    await Promise.all([boardChanged ? this.loadColumns() : Promise.resolve(), this.results.loadFirstPage()])
  }

  private async loadBoards(): Promise<void> {
    try {
      this.store.patch({ boards: (await this.boardApi.list(this.workspaceId, { size: BOARD_CHOICES })).items })
    } catch {
      // Without them the search still works, over every board.
    }
  }

  private async loadColumns(): Promise<void> {
    const { boardId } = this.store.value.criteria
    if (!boardId) return
    try {
      const columns = await this.columnApi.list(this.workspaceId, boardId)
      if (this.store.value.criteria.boardId === boardId) this.store.patch({ columns })
    } catch {
      // Without them the search narrows to the board only.
    }
  }

  /** The criteria as the backend takes them: the words, and every chosen field together. */
  private input(): CardSearchDTO {
    const { text, boardId, columnId, assigneeId } = this.store.value.criteria
    const conditions: CardFilterDTO[] = [
      ...(boardId ? [{ field: 'board', op: 'eq', value: boardId } as const] : []),
      ...(columnId ? [{ field: 'column', op: 'eq', value: columnId } as const] : []),
      ...(assigneeId ? [{ field: 'assignee', op: 'eq', value: assigneeId } as const] : []),
    ]
    return {
      text: text.trim() || undefined,
      filter: conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : { and: conditions },
    }
  }
}
