import type { RecentBoardDTO, WorkspaceBoardDTO, WorkspaceDetailDTO, WorkspaceMemberDTO, WorkspaceSummaryDTO } from '../../../backend/contexts/backoffice/modules/workspace/workspace.schema'
import type { Page } from 'newt-kit/contract'
import { type PageRequest, Requester } from 'newt-kit-react'

/** The backoffice's `workspace` module: every workspace of cooper, as the staff see them. */
export class BackofficeWorkspaceApi extends Requester {
  protected readonly path = '/workspaces'

  /** The newest first; with a name, those with it (whole, whatever its case). */
  list(name: string | undefined, page?: PageRequest) {
    return this.get<Page<WorkspaceSummaryDTO>>('', { name, ...page })
  }

  /** The boards created last, across every workspace. */
  recentBoards() {
    return this.get<RecentBoardDTO[]>('/recent-boards')
  }

  getWorkspace(workspaceId: string) {
    return this.get<WorkspaceDetailDTO>(`/${workspaceId}`)
  }

  /** Its members, its admin first. */
  members(workspaceId: string, page?: PageRequest) {
    return this.get<Page<WorkspaceMemberDTO>>(`/${workspaceId}/members`, page)
  }

  /** Its boards, the newest first, each with its cards. */
  boards(workspaceId: string, page?: PageRequest) {
    return this.get<Page<WorkspaceBoardDTO>>(`/${workspaceId}/boards`, page)
  }
}
