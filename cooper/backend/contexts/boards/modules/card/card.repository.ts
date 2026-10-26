import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Card, MAX_CARDS, type CardDTO } from './card'
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
  async persistNew(card: Card): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`boardCards:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
      after: async () => {
        const count = await this.count({ boardId })
        if (count > MAX_CARDS) throw new TooManyCards(boardId)
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
