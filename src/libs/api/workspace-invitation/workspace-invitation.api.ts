import type { WorkspaceInvitationCreateDTO, WorkspaceInvitationDTO, WorkspaceInvitationResultDTO } from '../../../backend/modules/workspace-invitation/workspace-invitation.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `workspace-invitation` module: bringing in people without an account. */
export class WorkspaceInvitationApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of the workspace's pending invitations, oldest first. */
  pending(workspaceId: string, page?: PageRequest) {
    return this.get<Page<WorkspaceInvitationDTO>>(`/${workspaceId}/invitations`, page)
  }

  /** Adds them at once when the email has an account; otherwise invites them. */
  invite(workspaceId: string, input: WorkspaceInvitationCreateDTO) {
    return this.post<WorkspaceInvitationResultDTO>(`/${workspaceId}/invitations`, input)
  }

  cancel(workspaceId: string, invitationId: string) {
    return this.delete<void>(`/${workspaceId}/invitations/${invitationId}`)
  }
}
