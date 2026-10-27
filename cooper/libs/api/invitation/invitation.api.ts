import { Requester } from 'newt-react'
import type { InvitationAcceptedDTO, InvitationCreateDTO, InvitationDTO, InvitationPreviewDTO } from './invitation.contract'

/** Invitations to a workspace: auth's, through boards' origin. */
export class InvitationApi extends Requester {
  protected readonly path = ''

  /** A workspace's invitations, the newest first. Admins only. */
  list(workspaceId: string) {
    return this.get<InvitationDTO[]>(`/workspaces/${workspaceId}/invitations`)
  }

  /** Sends the link by email. Admins only. */
  invite(workspaceId: string, input: InvitationCreateDTO) {
    return this.post<InvitationDTO>(`/workspaces/${workspaceId}/invitations`, input)
  }

  /** The link stops working. Admins only. */
  revoke(workspaceId: string, invitationId: string) {
    return this.delete<void>(`/workspaces/${workspaceId}/invitations/${invitationId}`)
  }

  /** What an invitation link is about, for the person who opened it. */
  preview(token: string) {
    return this.get<InvitationPreviewDTO>(`/invitations/${token}`)
  }

  /** The signed-in person, with the invited email, joins the workspace. */
  accept(token: string) {
    return this.post<InvitationAcceptedDTO>(`/invitations/${token}/accept`)
  }
}
