import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

/**
 * boards follows auth's workspaces, a moment later: a new one gets its welcome board,
 * and a deleted one loses everything it had here. Each reaction is a job of auth's
 * worker, saved with the change that tells it, and run until it completes.
 */
export function registerWorkspaceWorkers(workspace: Workspace_Module, deps: Workspace_Deps): void {
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
  deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.purge.on.tenant.deleted',
    // The workspace is gone in auth already: a purge that keeps failing must not die soon.
    attempts: 10,
  })
}
