import { eventsOf, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { ColumnDTO } from '../column/column.schema'
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  CardFilter,
  CardMoveSchema,
  CardSearchSchema,
  type CardAssignDTO,
  type CardCountByBoard,
  type CardCountByWorkspace,
  type CardCreateDTO,
  type CardDTO,
  type CardEditDTO,
  type CardMoveDTO,
  type CardSearchDTO,
} from './card'
import type { Card_Deps } from './card.deps'
import type { Card_Options } from './card-options'
import { Card_Repository, type CardRow } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { registerCardWorkers } from './card.workers'
import { AssigneeNotMember } from './errors/assignee-not-member'
import { CardNotFound } from './errors/card-not-found'
import { ColumnNotEmpty } from './errors/column-not-empty'
import { ColumnNotInBoard } from './errors/column-not-in-board'
import { Card_Assigned } from './events/card-assigned'
import { Card_Created } from './events/card-created'
import { Card_Deleted } from './events/card-deleted'
import { Card_Edited } from './events/card-edited'
import { Card_Moved } from './events/card-moved'
import { Card_Unassigned } from './events/card-unassigned'

/**
 * The cards of each board: what there is to do, in the column of its status, and
 * who does it. A card points at its board and its column (modules of `boards`) and at
 * its assignee (a member, kept by auth), each by id.
 */
export class Card_Module extends Module {

  static initialize(base: BoardsBase, deps: Card_Deps, options: Card_Options): Card_Module {
    const module = new Card_Module(base, new Card_Repository(base), deps, options)
    registerCardRoutes(base, module, deps)
    registerCardWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(
    base: BoardsBase,
    private readonly repo: Card_Repository,
    private readonly deps: Card_Deps,
    private readonly options: Card_Options,
  ) {
    super('card', base.invocations)
    this.events = eventsOf(base.bus, {
      created: Card_Created,
      edited: Card_Edited,
      moved: Card_Moved,
      assigned: Card_Assigned,
      unassigned: Card_Unassigned,
      deleted: Card_Deleted,
    })
  }

  /**
   * A board's cards, column by column and from the top: whole, since a board is read
   * as one screen. The list that grows without end, the search, comes by pages.
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
   * A page of the workspace's cards that have the text and pass the filter: only the
   * fields and operators `CardFilter` allows.
   */
  @UseCase()
  async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
    const { text, filter } = CardSearchSchema.parse(input)
    const criteria = filter ? CardFilter.toCriteria<CardRow>(filter) : {}
    const found = await this.repo.search(criteria, text, page)
    return {
      items: found.items.map(card => card.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  /** A new card at the bottom of a column of the board, with the board's next number. */
  @UseCase()
  async create(boardId: string, input: CardCreateDTO): Promise<CardDTO> {
    const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
    const board = await this.deps.board.get(boardId)
    await this.assertColumnOf(boardId, columnId)
    if (assigneeId !== null) await this.assertMember(assigneeId)
    const card = Card.create({
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
    await this.repo.persistNew(card)
    return card.toDTO()
  }

  @UseCase()
  async edit(id: string, input: CardEditDTO): Promise<CardDTO> {
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
  async move(id: string, input: CardMoveDTO): Promise<CardDTO> {
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
  async assign(id: string, input: CardAssignDTO): Promise<CardDTO> {
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
   * module cannot ask them without the two needing each other (ch. 19). So this use
   * case asks, and has the column module remove it: a write to another module outside
   * a worker, said where it is seen. It is the only write it makes, so a failure leaves
   * nothing halfway; a card moved into the column at that very moment is taken to
   * another one by `leaveRemovedColumn`.
   */
  @UseCase({ writesTo: ['column'] })
  async removeColumn(columnId: string): Promise<void> {
    const column = await this.deps.column.get(columnId)
    const cards = await this.repo.count({ columnId })
    if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
    await this.deps.column.remove(column.id)
  }

  /**
   * A column was removed: any card still in it goes to the bottom of the board's
   * first column. What a worker calls (ch. 20.3); the second time, there are none.
   */
  @UseCase()
  async leaveRemovedColumn(column: ColumnDTO): Promise<void> {
    await runInWorkspace(column.workspaceId, async () => {
      const left = await this.repo.inColumn(column.id)
      if (left.length === 0) return
      const [first] = await this.deps.column.list(column.boardId)
      if (!first) return
      const bottom = await this.repo.count({ columnId: first.id })
      left.forEach((card, index) => card.moveTo(first.id, bottom + index))
      await this.repo.persistOrder(left, [column.id, first.id])
    })
  }

  /**
   * Tells the assignee of a card they have it, by email: from a worker, once the
   * assignment is saved, since an email cannot be taken back (ch. 16). Run late, it
   * reads the card again: if it is gone, or has another assignee by then, there is
   * nothing to tell (that assignment tells its own).
   */
  @UseCase()
  async notifyAssignee(card: CardDTO): Promise<void> {
    if (card.assigneeId === null) return
    const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
    if (current?.assigneeId !== card.assigneeId) return
    const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
    if (!member) return
    const link = new URL(`/workspaces/${card.workspaceId}/boards/${card.boardId}?card=${card.number}`, this.options.publicUrl)
    await this.options.mailer.send({
      to: member.email,
      subject: `#${card.number} ${card.title} is yours`,
      text: [`Hi ${member.name},`, '', `Card #${card.number}, "${card.title}", is assigned to you.`, '', link.toString()].join('\n'),
    })
  }

  /**
   * Someone lost their access to a workspace: its cards they had are left without an
   * assignee. What a worker calls, reacting to auth; the second time, they have none.
   */
  @UseCase()
  async unassignMember(workspaceId: string, userId: string): Promise<void> {
    await runInWorkspace(workspaceId, async () => {
      const cards = await this.repo.find({ assigneeId: userId })
      for (const card of cards) card.unassign()
      await this.repo.persist(...cards)
    })
  }

  /** For other contexts (the staff's backoffice): how many cards each of these workspaces has. */
  @UseCase()
  async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
    return this.repo.countByWorkspace([...new Set(workspaceIds)])
  }

  /** For other contexts: how many cards each board of a workspace has. */
  @UseCase()
  async countByBoard(workspaceId: string): Promise<CardCountByBoard[]> {
    return runInWorkspace(workspaceId, () => this.repo.countByBoard())
  }

  /** A workspace was deleted in auth: its cards go. A step of that deletion, safe to run again (ch. 18). */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }

  private load(id: string): Promise<Card> {
    return this.resolve(() => this.repo.find({ id }), () => new CardNotFound(id))
  }

  /** The column a card goes to is one of its board's: asked to the column module, a read. */
  private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
    const columns = await this.deps.column.list(boardId)
    if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
  }

  /** The assignee belongs to the workspace now: asked to auth, through the member module, every time (ch. 20). */
  private async assertMember(userId: string): Promise<void> {
    if (!await this.deps.member.isMember(userId)) throw new AssigneeNotMember(userId)
  }
}
