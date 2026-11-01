import { Requester } from 'newt-kit-react'
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

  /** The signed-in member takes themselves out (`userId` is theirs); the admin cannot. Their cards are unassigned. */
  leave(workspaceId: string, userId: string) {
    return this.delete<void>(`/${workspaceId}/members/${userId}`)
  }
}
