import type { WorkspaceCreateDTO, WorkspaceDTO, WorkspaceMineDTO, WorkspaceUpdateDTO } from '../../../backend/modules/workspace/workspace.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `workspace` module: the workspaces of the signed-in person. */
export class WorkspaceApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of the signed-in person's workspaces, newest first. */
  mine(page?: PageRequest) {
    return this.get<Page<WorkspaceMineDTO>>('', page)
  }

  /** One workspace; a 404 when it does not exist or the person is not in it. */
  one(workspaceId: string) {
    return this.get<WorkspaceMineDTO>(`/${workspaceId}`)
  }

  create(input: WorkspaceCreateDTO) {
    return this.post<WorkspaceMineDTO>('', input)
  }

  update(workspaceId: string, changes: WorkspaceUpdateDTO) {
    return this.patch<WorkspaceDTO>(`/${workspaceId}`, changes)
  }

  archive(workspaceId: string) {
    return this.post<WorkspaceDTO>(`/${workspaceId}/archive`)
  }

  unarchive(workspaceId: string) {
    return this.post<WorkspaceDTO>(`/${workspaceId}/unarchive`)
  }
}
