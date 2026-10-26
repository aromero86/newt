import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  CardMoveSchema,
  MAX_CARDS,
  type CardDTO,
} from './card'
import type { Card_Deps } from './card.deps'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { AssigneeNotMember } from './errors/assignee-not-member'
import { CardNotFound } from './errors/card-not-found'
import { ColumnNotEmpty } from './errors/column-not-empty'
import { ColumnNotInBoard } from './errors/column-not-in-board'
import { TooManyCards } from './errors/too-many-cards'

/**
 * The cards of each board: what there is to do, in the column of its status, and
 * who does it. A card points at its board and its column (modules of `boards`) and at
 * its assignee (a member, kept by auth), each by id.
 */
export class Card_Module extends Module {

  static initialize(base: BoardsBase, deps: Card_Deps): Card_Module {
    const module = new Card_Module(base, new Card_Repository(base), deps)
    registerCardRoutes(base, module, deps)
    return module
  }

  private constructor(
    base: BoardsBase,
    private readonly repo: Card_Repository,
    private readonly deps: Card_Deps,
  ) {
    super('card', base.invocations)
  }

  /**
   * A board's cards, column by column and from the top: whole, since a board is read
   * as one screen and holds at most `MAX_CARDS`.
   */
  @UseCase()
  async listInBoard(boardId: string): Promise<CardDTO[]> {
    const cards = await this.repo.find({ boardId }, { orderBy: [{ field: 'columnId' }, { field: 'position' }] })
    return cards.map(card => card.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<CardDTO> {
    return (await this.load(id)).toDTO()
  }

  /** A card by its number on its board: #12 of the roadmap. */
  @UseCase()
  async getByNumber(boardId: string, number: number): Promise<CardDTO> {
    return (await this.resolve(() => this.repo.find({ boardId, number }), () => new CardNotFound(`#${number}`))).toDTO()
  }

  /**
   * A new card at the bottom of a column of the board, with the board's next number:
   * a board holds at most `MAX_CARDS`.
   */
  @UseCase()
  async create(boardId: string, input: unknown): Promise<CardDTO> {
    const card = await this.newCard(boardId, input)
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (await this.repo.count({ boardId }) >= MAX_CARDS) throw new TooManyCards(boardId)
    await this.repo.persistNew(card)
    return card.toDTO()
  }

  @UseCase()
  async edit(id: string, input: unknown): Promise<CardDTO> {
    const changes = CardEditSchema.parse(input)
    const card = await this.load(id)
    card.edit(changes)
    await this.repo.persist(card)
    return card.toDTO()
  }

  /**
   * Moves a card to a column of its board (the same one, too) at a position, and the
   * cards around take the places left and made: several cards saved at once, all or
   * none. Whoever moved one of them meanwhile, this card too, makes it run again from
   * the start, with the columns as they are then: two people dragging the same card
   * at once both get their move, one after the other.
   */
  @UseCase()
  async move(id: string, input: unknown): Promise<CardDTO> {
    const { columnId, position } = CardMoveSchema.parse(input)
    const card = await this.load(id)
    const from = card.columnId
    if (columnId !== from) await this.assertColumnOf(card.boardId, columnId)
    const left = (await this.repo.inColumn(from)).filter(each => each.id !== id)
    const target = columnId === from ? left : await this.repo.inColumn(columnId)
    const at = Math.min(position ?? target.length, target.length)
    target.splice(at, 0, card)
    if (target !== left) left.forEach((each, index) => each.reposition(index))
    target.forEach((each, index) => each === card ? card.moveTo(columnId, index) : each.reposition(index))
    await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
    return card.toDTO()
  }

  /** Assigns it to a member of its workspace: anyone else is a mistake of the request (400). */
  @UseCase()
  async assign(id: string, input: unknown): Promise<CardDTO> {
    const { assigneeId } = CardAssignSchema.parse(input)
    const card = await this.load(id)
    await this.assertMember(assigneeId)
    card.assign(assigneeId)
    await this.repo.persist(card)
    return card.toDTO()
  }

  @UseCase()
  async unassign(id: string): Promise<CardDTO> {
    const card = await this.load(id)
    card.unassign()
    await this.repo.persist(card)
    return card.toDTO()
  }

  /** Deletes it, and the cards under it move one place up. Its number is not given again. */
  @UseCase()
  async delete(id: string): Promise<void> {
    const card = await this.load(id)
    const others = (await this.repo.inColumn(card.columnId)).filter(each => each.id !== id)
    others.forEach((each, index) => each.reposition(index))
    card.delete()
    await this.repo.persistOrder([card, ...others], [card.columnId])
  }

  /**
   * Removes a column of a board, only if no card is in it. The cards answer, since a
   * card points at its column and a column knows nothing of the cards: the column
   * module cannot ask them without the two needing each other. So this use
   * case asks, and has the column module remove it: a write to another module outside
   * a worker, said where it is seen. It is the only write it makes, so a failure leaves
   * nothing halfway.
   */
  @UseCase({ writesTo: ['column'] })
  async removeColumn(columnId: string): Promise<void> {
    const column = await this.deps.column.get(columnId)
    const cards = await this.repo.count({ columnId })
    if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
    await this.deps.column.remove(column.id)
  }

  /** A new card of a board, checked: its column is the board's, its assignee a member. */
  private async newCard(boardId: string, input: unknown): Promise<Card> {
    const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
    const board = await this.deps.board.get(boardId)
    await this.assertColumnOf(boardId, columnId)
    if (assigneeId !== null) await this.assertMember(assigneeId)
    return Card.create({
      workspaceId: board.workspaceId,
      boardId,
      columnId,
      // What they look to be now; the save reads them again, where nothing slips in.
      number: await this.repo.nextNumber(boardId),
      position: await this.repo.count({ columnId }),
      title,
      description,
      assigneeId,
    })
  }

  private load(id: string): Promise<Card> {
    return this.resolve(() => this.repo.find({ id }), () => new CardNotFound(id))
  }

  /** The column a card goes to is one of its board's: asked to the column module, a read. */
  private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
    const columns = await this.deps.column.list(boardId)
    if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
  }

  /** The assignee belongs to the workspace now: asked to auth, through the member module, every time. */
  private async assertMember(userId: string): Promise<void> {
    if (!await this.deps.member.isMember(userId)) throw new AssigneeNotMember(userId)
  }
}
