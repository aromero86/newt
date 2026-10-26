import { Requester } from '../core/requester'
import type { WorkspaceCreateDTO, WorkspaceDTO, WorkspaceRenameDTO } from './workspace.contract'

/** The signed-in person's workspaces: auth's tenants, through boards' origin. */
export class WorkspaceApi extends Requester {
  protected readonly path = '/workspaces'

  /** Every workspace the signed-in person is a member of: a short list, whole. */
  list() {
    return this.get<WorkspaceDTO[]>('')
  }

  /** A new workspace, with the signed-in person as its admin. */
  create(input: WorkspaceCreateDTO) {
    return this.post<WorkspaceDTO>('', input)
  }

  /** Admins only. */
  rename(workspaceId: string, input: WorkspaceRenameDTO) {
    return this.patch<WorkspaceDTO>(`/${workspaceId}`, input)
  }

  /** Admins only: the workspace, its members and its boards are gone. */
  remove(workspaceId: string) {
    return this.delete<void>(`/${workspaceId}`)
  }
}
