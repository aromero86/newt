import { allOf, ConcurrencyConflict, toPage, type Criteria, type Page, type PageRequest } from 'newt/core'
import { TableRepository } from 'newt/repository'
import { sql } from 'kysely'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Card, type CardCountByBoard, type CardCountByWorkspace, type CardDTO } from './card'

export type CardRow = CardDTO & { version: number }

export class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card', { unique: [['boardId', 'number']] }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: CardRow): Card {
    return Card.fromDTO(row)
  }

  /** A column's cards, from the top. */
  inColumn(columnId: string): Promise<Card[]> {
    return this.find({ columnId }, { orderBy: [{ field: 'position' }] })
  }

  /** The number the next card of a board gets: one more than the last one's. */
  async nextNumber(boardId: string): Promise<number> {
    const [last] = await this.find({ boardId }, { orderBy: [{ field: 'number', direction: 'desc' }], limit: 1 })
    return (last?.toDTO().number ?? 0) + 1
  }

  /**
   * Saves a new card with the next number of its board and at the bottom of its
   * column, both read inside the save, guarding the board's numbers and the column's
   * order: two cards created at once in a board get #7 and #8, in any store, and
   * neither waits for a conflict to try again.
   *
   * The number is a value everyone changes at once (ch. 11), so no row keeps a counter
   * that every new card would update, and collide on: a card's number is what its
   * board's cards already have, plus one, and the cards are only ever added. The
   * table's unique index on (board, number) is the last word.
   */
  async persistNew(card: Card): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`cardNumbers:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.nextNumber(boardId), await this.count({ columnId })),
    })
  }

  /**
   * Saves cards in their new order, all of them or none (ch. 8.2): the one moved or
   * deleted, and the ones that took the places left, in each column it touches. Each
   * was read at a version, so a card someone else moved meanwhile makes it a
   * conflict, and the use case runs again with the columns as they are then (ch. 9).
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
          if (positions.some((position, index) => position !== index)) throw new ConcurrencyConflict()
        }
      },
    })
  }

  /**
   * A page of the cards that meet the criteria and, if `text` is given, have it in
   * their title or description, whatever its case. Criteria have no "contains", so the
   * text is looked for with Kysely (portable to Postgres and MySQL: `lower` and
   * `like`), in the current workspace, and its cards' ids join the criteria.
   */
  async search(criteria: Criteria<CardRow>, text: string | undefined, page: PageRequest): Promise<Page<Card>> {
    if (!text) return this.page(criteria, page)
    const pattern = `%${text.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
    const matching = await this.base.db
      .selectFrom('card')
      .select('id')
      .where('workspaceId', '=', currentWorkspaceId())
      .where(eb => eb.or([
        sql<boolean>`lower(${eb.ref('title')}) like ${pattern} escape '\\'`,
        sql<boolean>`lower(${eb.ref('description')}) like ${pattern} escape '\\'`,
      ]))
      .execute()
    if (matching.length === 0) return toPage([], page.size, 0)
    return this.page(allOf(criteria, { id: { in: matching.map(row => row.id) } }), page)
  }

  /**
   * How many cards each of these workspaces has, by one query that groups them (ch.
   * 26). Across workspaces on purpose: for the staff's backoffice, which looks at
   * all of them, never for a workspace's own work.
   */
  async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
    if (workspaceIds.length === 0) return []
    const rows = await this.base.db
      .selectFrom('card')
      .select(eb => ['workspaceId', eb.fn.countAll<number>().as('cards')])
      .where('workspaceId', 'in', workspaceIds)
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

  /** Removes every card of a workspace for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.saveRows(async () => {
      await this.base.db.deleteFrom('card').where('workspaceId', '=', workspaceId).execute()
    })
  }
}
