import type { WorkspaceMemberAddDTO, WorkspaceMemberDTO, WorkspaceMemberRole } from '../../../backend/modules/workspace-member/workspace-member.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `workspace-member` module: who is in a workspace. */
export class WorkspaceMemberApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of the workspace's members, in the order they joined. */
  list(workspaceId: string, page?: PageRequest) {
    return this.get<Page<WorkspaceMemberDTO>>(`/${workspaceId}/members`, page)
  }

  add(workspaceId: string, input: WorkspaceMemberAddDTO) {
    return this.post<void>(`/${workspaceId}/members`, input)
  }

  remove(workspaceId: string, userId: string) {
    return this.delete<void>(`/${workspaceId}/members/${userId}`)
  }

  /** The signed-in person leaves. */
  leave(workspaceId: string) {
    return this.delete<void>(`/${workspaceId}/members/me`)
  }

  changeRole(workspaceId: string, userId: string, role: WorkspaceMemberRole) {
    return this.patch<void>(`/${workspaceId}/members/${userId}`, { role })
  }
}
