import { allPages, currentActor, eventsOf, log, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt-kit/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
import type { ColumnDTO } from '../column/column.schema'
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  CardFilter,
  CardMoveSchema,
  CardSearchSchema,
  MAX_CARDS,
  type CardAuthor,
  type CardCountByBoard,
  type CardCountByWorkspace,
  type CardCreateDTO,
  type CardDTO,
} from './card'
import type { Card_Deps } from './card.deps'
import type { Card_Options } from './card-options'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { registerCardWorkers } from './card.workers'
import { AssigneeNotMember } from './errors/assignee-not-member'
import { CardNotFound } from './errors/card-not-found'
import { ColumnNotEmpty } from './errors/column-not-empty'
import { ColumnNotInBoard } from './errors/column-not-in-board'
import { TooManyCards } from './errors/too-many-cards'
import { Card_Assigned } from './events/card-assigned'
import { Card_Created } from './events/card-created'
import { Card_Deleted } from './events/card-deleted'
import { Card_Edited } from './events/card-edited'
import { Card_Moved } from './events/card-moved'
import { Card_Unassigned } from './events/card-unassigned'

/** Boards' own work, from a worker: no one did it. */
const BOARDS: CardAuthor = { by: null, via: null }

/** The person acting now, as a card's events tell it: a use case a route or an MCP tool called. */
function actingAuthor(): CardAuthor & { by: string } {
  const { userId, via } = currentActor()
  return { by: userId, via }
}

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
    super('card', base.invocations, deps)
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
   * as one screen and holds at most `MAX_CARDS`. The list that grows without end, the
   * search, comes by pages.
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
   * fields and operators `CardFilter` allows. The search finds their ids, a moment
   * behind; the cards are read as they are now, and one gone since is left out.
   */
  @UseCase()
  async search(input: unknown, page: PageRequest): Promise<Page<CardDTO>> {
    const { text, filter } = CardSearchSchema.parse(input)
    const criteria = filter ? CardFilter.toCriteria<CardDTO>(filter) : {}
    const found = await this.options.search.search(currentWorkspaceId(), { text, criteria }, page)
    const cards = new Map((await this.repo.find({ id: { in: found.items } })).map(card => [card.id, card]))
    // The next page starts after the last id the search found, whether or not its card is still there.
    return mapPage({ ...found, nextCursor: found.items.at(-1) }, id => cards.get(id)?.toDTO())
  }

  /**
   * A new card at the bottom of a column of the board, with the board's next number:
   * a board holds at most `MAX_CARDS`.
   */
  @UseCase()
  async create(boardId: string, input: unknown): Promise<CardDTO> {
    const card = await this.newCard(boardId, input, actingAuthor())
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (await this.repo.count({ boardId }) >= MAX_CARDS) {
      log.warn('a board is full', { boardId, max: MAX_CARDS })
      throw new TooManyCards(boardId)
    }
    await this.repo.persistNew(card)
    log.info('card created', { cardId: card.id, boardId, number: card.toDTO().number })
    return card.toDTO()
  }

  /**
   * A board's first card, unless it has one already (null then): what a worker
   * preparing a board calls, as many times as it takes. Runs at once create it once:
   * the save counts the board's cards again.
   */
  @UseCase()
  async createFirst(boardId: string, input: CardCreateDTO): Promise<CardDTO | null> {
    if (await this.repo.count({ boardId }) > 0) return null
    const card = await this.newCard(boardId, input, BOARDS)
    await this.repo.persistNew(card, { first: true })
    return card.toDTO()
  }

  @UseCase()
  async edit(id: string, input: unknown): Promise<CardDTO> {
    const changes = CardEditSchema.parse(input)
    const card = await this.load(id)
    card.edit(changes, actingAuthor())
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
    target.forEach((each, index) => each === card ? card.moveTo(columnId, index, actingAuthor()) : each.reposition(index))
    await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
    log.info('card moved', { cardId: id, from, to: columnId, position: at, reordered: target.length + (target === left ? 0 : left.length) })
    return card.toDTO()
  }

  /** Assigns it to a member of its workspace: anyone else is a mistake of the request (400). */
  @UseCase()
  async assign(id: string, input: unknown): Promise<CardDTO> {
    const { assigneeId } = CardAssignSchema.parse(input)
    const card = await this.load(id)
    await this.assertMember(assigneeId)
    card.assign(assigneeId, actingAuthor())
    await this.repo.persist(card)
    return card.toDTO()
  }

  @UseCase()
  async unassign(id: string): Promise<CardDTO> {
    const card = await this.load(id)
    card.unassign(actingAuthor())
    await this.repo.persist(card)
    return card.toDTO()
  }

  /** Deletes it, and the cards under it move one place up. Its number is not given again. */
  @UseCase()
  async delete(id: string): Promise<void> {
    const card = await this.load(id)
    const others = (await this.repo.inColumn(card.columnId)).filter(each => each.id !== id)
    others.forEach((each, index) => each.reposition(index))
    card.delete(actingAuthor())
    await this.repo.persistOrder([card, ...others], [card.columnId])
  }

  /**
   * Removes a column of a board, only if no card is in it. The cards answer, since a
   * card points at its column and a column knows nothing of the cards: the column
   * module cannot ask them without the two needing each other. So this use
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
   * A column may be gone: any card still in it goes to the bottom of the board's first
   * column. What a worker calls when a column is removed, and when a card is created
   * in one or moved to one: the card checked its column before its save, and the
   * column may have gone in between, its own worker finding no card yet. Each runs after
   * its own save and looks at the other's, so whichever runs last finds the card.
   * Safe to run again: a column still there, or with no card in it, is left as it is.
   */
  @UseCase()
  async leaveRemovedColumn(column: Pick<ColumnDTO, 'id' | 'boardId' | 'workspaceId'>): Promise<void> {
    await runInWorkspace(column.workspaceId, async () => {
      const left = await this.repo.inColumn(column.id)
      if (left.length === 0) return
      const columns = await this.deps.column.list(column.boardId)
      if (columns.some(each => each.id === column.id)) return
      const [first] = columns
      // Never none: a board keeps one column at least (`column.remove`).
      if (!first) return
      const bottom = await this.repo.count({ columnId: first.id })
      left.forEach((card, index) => card.moveTo(first.id, bottom + index, BOARDS))
      await this.repo.persistOrder(left, [column.id, first.id])
    })
  }

  /**
   * Tells the assignee of a card they have it, by email: from a worker, once the
   * assignment is saved, since an email cannot be taken back. Run late, it
   * reads the card again: if it is gone, or has another assignee by then, there is
   * nothing to tell (that assignment tells its own). Nor is anyone told of a card
   * they gave themselves (`by`, who created or assigned it). Its job may run twice:
   * the email's key is the event's id (`eventId`), so it is sent once.
   */
  @UseCase()
  async notifyAssignee(card: CardDTO, by: string | null, eventId: string): Promise<void> {
    if (card.assigneeId === null || card.assigneeId === by) return
    const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
    if (current?.assigneeId !== card.assigneeId) return
    const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
    if (!member) {
      log.debug('the assignee left the workspace: nobody told', { cardId: card.id, assigneeId: card.assigneeId })
      return
    }
    // Where boards' UI opens the card: on its board's screen, by its id.
    const link = new URL(`/w/${card.workspaceId}/boards/${card.boardId}?card=${card.id}`, this.options.publicUrl)
    await this.options.mailer.send({
      to: member.email,
      subject: `#${card.number} ${card.title} is yours`,
      text: [`Hi ${member.name},`, '', `Card #${card.number}, "${card.title}", is assigned to you.`, '', link.toString()].join('\n'),
      key: `card.notifyAssignee:${eventId}`,
    })
    log.info('assignee told', { cardId: card.id, assigneeId: card.assigneeId })
  }

  /**
   * Someone may have lost their access to a workspace: if they do not belong to it,
   * its cards they had are left without an assignee. What a worker calls when auth
   * takes their access away, and when a card is given to someone (created for them,
   * or assigned): they were checked before its save, and may have left in between,
   * auth's worker finding no card of theirs yet. Each runs after its own save and
   * looks at the other's, so whichever runs last finds the card. Asked again here,
   * someone let in again since keeps their cards. Safe to run again. A workspace auth
   * deleted is left alone: its purge removes its cards, and nothing is told of them.
   */
  @UseCase()
  async unassignMember(workspaceId: string, userId: string): Promise<void> {
    if (!await this.deps.member.exists(workspaceId)) return
    if (await this.deps.member.find(workspaceId, userId)) return
    await runInWorkspace(workspaceId, async () => {
      const cards = await this.repo.find({ assigneeId: userId })
      for (const card of cards) card.unassign(BOARDS)
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

  /**
   * The search finds a card as it is now: read again, it is indexed, or removed if it
   * is gone. What a worker calls on every change of a card, in any order, as many
   * times as it takes: each run indexes what is there then, and two at once that
   * hand the search their copies in the wrong order leave it the newer one, or none
   * once the card is deleted.
   */
  @UseCase()
  async indexCard(workspaceId: string, id: string): Promise<void> {
    const card = await runInWorkspace(workspaceId, () => this.repo.first({ id }))
    if (card) await this.options.search.index(card.toDTO())
    else await this.options.search.remove(id)
    log.debug(card ? 'card indexed' : 'card out of the search', { cardId: id })
  }

  /**
   * Every card of every workspace indexed again: what boards does when it opens, since
   * a search in memory starts empty. Read a page at a time, all of them kept, as the
   * search keeps them too.
   */
  @UseCase()
  async reindex(): Promise<void> {
    const cards = await allPages(page => this.repo.pageInEveryScope(page))
    for (const card of cards) await this.options.search.index(card.toDTO())
  }

  /** A workspace was deleted in auth: its cards go, and the search forgets them. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
    await this.options.search.removeWorkspace(workspaceId)
  }

  /** A new card of a board, checked: its column is the board's, its assignee a member. */
  private async newCard(boardId: string, input: unknown, author: CardAuthor): Promise<Card> {
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
    }, author)
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
