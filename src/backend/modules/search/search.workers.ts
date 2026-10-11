import type { Search_Deps } from './search.deps'
import type { Search_Module } from './search.module'

export function registerSearchWorkers(search: Search_Module, deps: Search_Deps) {
  // Everything enters or leaves the definition through a proposal: whenever one
  // changes, its workspace's index is brought up to date.
  deps.proposal.changed.subscribe(({ workspaceId }) => search.scheduleReindex(workspaceId))
}
