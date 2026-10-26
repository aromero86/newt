import { toPage, type Criteria, type Page, type PageRequest } from 'newt/core'
import { whereOf } from 'newt/kysely'
import { TableRepository } from 'newt/repository'
import { sql, type SqlBool } from 'kysely'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Card, MAX_CARDS, type CardCountByBoard, type CardCountByWorkspace, type CardDTO } from './card'
import { TooManyCards } from './errors/too-many-cards'

export type CardRow = CardDTO & { version: number }

/** The last number a board gave a card: its id is the board's. A card deleted does not give it back. */
export type CardCounterRow = { id: string, workspaceId: string, lastNumber: number, version: number }

export class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {

  private readonly counters

  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card', { unique: [['boardId', 'number']] }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
    this.counters = base.store.table<CardCounterRow>('card_counter')
  }

  protected toEntity(row: CardRow): Card {
    return Card.fromDTO(row)
  }

  /** A column's cards, from the top. */
  inColumn(columnId: string): Promise<Card[]> {
    return this.find({ columnId }, { orderBy: [{ field: 'position' }] })
  }

  /** The number the next card of a board gets: one more than the last one it gave. */
  async nextNumber(boardId: string): Promise<number> {
    const [counter] = await this.counters.find({ id: boardId })
    return (counter?.lastNumber ?? 0) + 1
  }

  /**
   * Saves a new card with the next number of its board and at the bottom of its
   * column, both read inside the save, and only if the board is left with no more
   * than `MAX_CARDS`. The save guards the board's cards and the column's order: two
   * cards created at once in a board get #7 and #8, in any store, and neither waits
   * for a conflict to try again.
   *
   * The number is a value everyone changes at once: each board keeps the last one it
   * gave in a row of its own, which every new card of the board updates. Updated in
   * place, those saves would collide with each other; under the board's guard, they
   * take turns instead, and none is refused. The row is never lowered, so a deleted
   * card's number, even the last one's, is not given again. The table's unique index
   * on (board, number) is the last word.
   */
  async persistNew(card: Card, options: { first?: boolean } = {}): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`boardCards:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
      after: async () => {
        const count = await this.count({ boardId })
        if (count > MAX_CARDS) throw new TooManyCards(boardId)
        // Its board's first, and another one got in first: the use case runs again, and finds it.
        if (options.first && count > 1) this.conflict()
      },
    })
  }

  /**
   * Saves cards in their new order, all of them or none: the one moved or
   * deleted, and the ones that took the places left, in each column it touches. Each
   * was read at a version, so a card someone else moved meanwhile makes it a
   * conflict, and the use case runs again with the columns as they are then.
   * One created meanwhile has no version here: the order of each column is checked
   * whole after writing, guarding those columns, so it is a conflict too.
   */
  async persistOrder(cards: Card[], columnIds: string[]): Promise<void> {
    const columns = [...new Set(columnIds)]
    await this.save(cards, each => this.write(each), {
      guard: columns.map(columnId => `cards:${columnId}`),
      after: async () => {
        for (const columnId of columns) {
          const positions = (await this.inColumn(columnId)).map(card => card.position)
          if (positions.some((position, index) => position !== index)) this.conflict()
        }
      },
    })
  }

  /**
   * A page of the current workspace's cards that meet the criteria and have the text in
   * their title or description, whatever its case: criteria have no "contains", so it
   * is one query of Kysely, with the criteria in it (`whereOf` says them as the store's
   * tables do), paged by id. `%` and `_` are only themselves: `!` escapes them.
   */
  async search(criteria: Criteria<CardDTO>, text: string | undefined, page: PageRequest): Promise<Page<Card>> {
    const pattern = `%${(text ?? '').replace(/[!%_]/g, '!$&')}%`
    const matching = this.base.db
      .selectFrom('card')
      .where('workspaceId', '=', currentWorkspaceId())
      .where(whereOf(this.store, criteria))
      .where(eb => eb.or([
        sql<SqlBool>`lower(${eb.ref('title')}) like lower(${pattern}) escape '!'`,
        sql<SqlBool>`lower(${eb.ref('description')}) like lower(${pattern}) escape '!'`,
      ]))
    const [rows, counted] = await Promise.all([
      matching.selectAll().$if(page.cursor !== undefined, query => query.where('id', '>', page.cursor!)).orderBy('id').limit(page.size + 1).execute(),
      matching.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
    ])
    return toPage(rows.map(row => this.toEntity(row)), page.size, Number(counted.total))
  }

  /**
   * How many cards each of these workspaces has, by one query that groups them.
   * Across workspaces on purpose: for the staff's backoffice, which looks at
   * all of them, never for a workspace's own work.
   */
  async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
    if (workspaceIds.length === 0) return []
    const rows = await this.base.db
      .selectFrom('card')
      .select(eb => ['workspaceId', eb.fn.countAll<number>().as('cards')])
      // Criteria, as a table takes them, said in Kysely's query by `whereOf`.
      .where(whereOf(this.store, { workspaceId: { in: workspaceIds } }))
      .groupBy('workspaceId')
      .execute()
    const counts = new Map(rows.map(row => [row.workspaceId, Number(row.cards)]))
    return workspaceIds.map(workspaceId => ({ workspaceId, cards: counts.get(workspaceId) ?? 0 }))
  }

  /** How many cards each board of the current workspace has: boards without any are not there. */
  async countByBoard(): Promise<CardCountByBoard[]> {
    const rows = await this.base.db
      .selectFrom('card')
      .select(eb => ['boardId', eb.fn.countAll<number>().as('cards')])
      .where('workspaceId', '=', currentWorkspaceId())
      .groupBy('boardId')
      .orderBy('boardId')
      .execute()
    return rows.map(row => ({ boardId: row.boardId, cards: Number(row.cards) }))
  }

  /** Removes every card of a workspace, and its boards' counters, for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.saveRows(async () => {
      await this.purge({ workspaceId })
      await this.counters.deleteMany({ workspaceId })
    })
  }

  /** The board's next number, taken: its counter one up, in the save of the card that gets it. */
  private async takeNumber(card: Card): Promise<number> {
    const [counter] = await this.counters.find({ id: card.boardId })
    if (!counter) {
      await this.counters.insert({ id: card.boardId, workspaceId: card.workspaceId, lastNumber: 1 })
      return 1
    }
    const number = counter.lastNumber + 1
    await this.counters.update(counter.id, counter.version, { lastNumber: number })
    return number
  }
}
