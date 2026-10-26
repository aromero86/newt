import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

/**
 * What the cards do when something happens, each a job saved with what it reacts to,
 * run by a worker until it succeeds, and safe to run again.
 */
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them.
  cards.events.created.subscribe(async card => {
    if (card.assigneeId !== null) await cards.notifyAssignee(card)
  }, {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
  })
  cards.events.assigned.subscribe(({ dto }) => cards.notifyAssignee(dto), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.assigned',
  })

  // A card points at its column: when a column goes, no card is left in it.
  deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.column.removed',
  })

  // auth took someone's access to a workspace: their cards there are left unassigned.
  deps.access.revoked.subscribe(async access => {
    if (access.tenantId !== null) await cards.unassignMember(access.tenantId, access.userId)
  }, {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
  })
}
