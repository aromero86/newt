import { z } from 'zod'

// No backend schema yet: invitations are auth's, which boards' routes serve to its
// web app. This is the contract those routes keep.

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'] as const

/** An invitation to a workspace, as its admin sees it. */
export const InvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  status: z.enum(INVITATION_STATUSES),
  createdAt: z.string(),
  /** Past it, the link no longer works. */
  expiresAt: z.string(),
})

/** `POST /api/workspaces/:id/invitations`: admins only. */
export const InvitationCreateSchema = z.object({
  email: z.string().trim().pipe(z.email('Write an email address')),
})

/** `GET /api/invitations/:token`: what the invitee sees before accepting. */
export const InvitationPreviewSchema = z.object({
  workspaceName: z.string(),
  /** Who it was sent to: only someone signed in with this email may accept it. */
  email: z.string(),
  /** The name of who sent it. */
  invitedBy: z.string(),
})

/** `POST /api/invitations/:token/accept`: the workspace the person is now in. */
export const InvitationAcceptedSchema = z.object({
  workspaceId: z.string(),
})

export type InvitationStatus = typeof INVITATION_STATUSES[number]
export type InvitationDTO = z.infer<typeof InvitationSchema>
export type InvitationCreateDTO = z.input<typeof InvitationCreateSchema>
export type InvitationPreviewDTO = z.infer<typeof InvitationPreviewSchema>
export type InvitationAcceptedDTO = z.infer<typeof InvitationAcceptedSchema>
