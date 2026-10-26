import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'
import type { Activity_Options } from './activity-options'

/** What the activity does when something happens to a card. */
export function registerActivityWorkers(activity: Activity_Module, deps: Activity_Deps, options: Activity_Options): void {
  const { events } = deps.card

  // A line in the server's log as each card moves, to watch a board live while
  // tracing. `fire-and-forget`: in memory, after the commit, with no job. If it fails,
  // or the server stops before it runs, the line is lost, and nothing is wrong: no
  // one needs it later.
  events.moved.subscribe(({ dto, previous, by, via }) => {
    options.log(`[boards] #${dto.number} "${dto.title}" moved from column ${previous.columnId} to ${dto.columnId} by ${by ?? 'cooper'}${via ? ` (${via})` : ''}`)
  }, { strategy: 'fire-and-forget' })
}
