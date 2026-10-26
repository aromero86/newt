import { Requester } from '../core/requester'
import type { WorkspaceMemberDTO } from './workspace-member.contract'

/** A workspace's members: auth's access to the tenant, through boards' origin. */
export class WorkspaceMemberApi extends Requester {
  protected readonly path = '/workspaces'

  /** Everyone in the workspace, its admin included. */
  list(workspaceId: string) {
    return this.get<WorkspaceMemberDTO[]>(`/${workspaceId}/members`)
  }

  /** Admins only, and never the admin: their cards are unassigned. */
  remove(workspaceId: string, userId: string) {
    return this.delete<void>(`/${workspaceId}/members/${userId}`)
  }
}
