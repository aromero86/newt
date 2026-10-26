import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'
import type { Activity_Options } from './activity-options'

/**
 * What the activity does when something happens to a card: each event a `handler`,
 * a job saved with the change, so no entry is ever missing, run until it succeeds
 * and safe to run again (keyed on the event's id).
 */
export function registerActivityWorkers(activity: Activity_Module, deps: Activity_Deps, options: Activity_Options): void {
  const { events } = deps.card
  events.created.subscribe(card => activity.recordCreated(card), { strategy: 'handler', queue: 'activity.recordCreated.on.card.created' })
  events.edited.subscribe(edit => activity.recordEdited(edit), { strategy: 'handler', queue: 'activity.recordEdited.on.card.edited' })
  events.moved.subscribe(move => activity.recordMoved(move), { strategy: 'handler', queue: 'activity.recordMoved.on.card.moved' })
  events.assigned.subscribe(assignment => activity.recordAssigned(assignment), { strategy: 'handler', queue: 'activity.recordAssigned.on.card.assigned' })
  events.unassigned.subscribe(unassignment => activity.recordUnassigned(unassignment), { strategy: 'handler', queue: 'activity.recordUnassigned.on.card.unassigned' })
  events.deleted.subscribe(card => activity.recordDeleted(card), { strategy: 'handler', queue: 'activity.recordDeleted.on.card.deleted' })

  // auth deleted a workspace: its log goes, like its boards (a job of auth's outbox).
  deps.tenants.deleted.subscribe(tenant => activity.purgeWorkspace(tenant.id), {
    strategy: 'handler',
    queue: 'activity.purgeWorkspace.on.tenant.deleted',
  })

  // A line in the server's log as each card moves, to watch a board live while
  // tracing. `fire-and-forget`: in memory, after the commit, with no job. If it fails,
  // or the server stops before it runs, the line is lost, and nothing is wrong: no
  // one needs it later, and the log above keeps the move for good.
  events.moved.subscribe(({ dto, previous, by, via }) => {
    options.log(`[boards] #${dto.number} "${dto.title}" moved from column ${previous.columnId} to ${dto.columnId} by ${by ?? 'cooper'}${via ? ` (${via})` : ''}`)
  }, { strategy: 'fire-and-forget' })
}
