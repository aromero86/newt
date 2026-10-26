import type { CardAuthor, CardDTO } from './card.schema'
import type { Card_Deps, RevokedAccess } from './card.deps'
import type { Card_Module } from './card.module'

/** A new card, given to someone: what `when` lets through to check they still belong. */
type CreatedFor = CardDTO & CardAuthor & { assigneeId: string }

/**
 * What the cards do when something happens, each a job saved with what it reacts to,
 * run by a worker until it succeeds, and safe to run again.
 */
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them, by someone else.
  cards.events.created.subscribe(({ by, ...card }, { id }) => cards.notifyAssignee(card, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
    when: card => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto, by }, { id }) => cards.notifyAssignee(dto, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.assigned',
  })

  // The search finds each card as it is now: whatever happened to it, it is indexed again, or removed.
  cards.events.created.subscribe(card => cards.indexCard(card.workspaceId, card.id), { strategy: 'handler', queue: 'card.indexCard.on.card.created' })
  cards.events.edited.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.edited' })
  cards.events.moved.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.moved' })
  cards.events.assigned.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.assigned' })
  cards.events.unassigned.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.unassigned' })
  cards.events.deleted.subscribe(card => cards.indexCard(card.workspaceId, card.id), { strategy: 'handler', queue: 'card.indexCard.on.card.deleted' })

  // A card points at its column: when a column goes, no card is left in it. A card
  // checks its column before its save, so the column may go in between: a card
  // created in one, or moved to one, looks again once saved. Whichever looks last finds it.
  deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.column.removed',
  })
  cards.events.created.subscribe(card => cards.leaveRemovedColumn({ id: card.columnId, boardId: card.boardId, workspaceId: card.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.created',
  })
  cards.events.moved.subscribe(({ dto }) => cards.leaveRemovedColumn({ id: dto.columnId, boardId: dto.boardId, workspaceId: dto.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.moved',
    when: ({ changes }) => changes.columnId !== undefined,
  })

  // auth took someone's access to a workspace: their cards there are left unassigned.
  // auth tells every access it takes away, to any product: only a workspace's is boards'.
  // A card checks its assignee before its save, so they may leave in between: a card
  // created for someone, or given to them, looks again once saved, the same way.
  // For now the product is named here: auth's WORKSPACES_PRODUCT (chapter 20) takes its place.
  deps.access.revoked.subscribe(access => cards.unassignMember(access.tenantId, access.userId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
    when: (access: RevokedAccess): access is RevokedAccess & { tenantId: string } => access.productId === 'cooper' && access.tenantId !== null,
  })
  cards.events.created.subscribe(card => cards.unassignMember(card.workspaceId, card.assigneeId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.card.created',
    when: (card: CardDTO & CardAuthor): card is CreatedFor => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto }) => cards.unassignMember(dto.workspaceId, dto.assigneeId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.card.assigned',
  })
}
