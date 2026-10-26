import { z } from 'zod'
import type { WorkspaceInvitationDTO } from '../../../backend/contexts/boards/modules/workspace/workspace.schema'

// Invitations are auth's, which boards' routes serve to its web app, in the shapes
// boards' workspace module says.
export {
  InvitationReviewSchema as InvitationPreviewSchema,
  WorkspaceInvitationSchema as InvitationSchema,
  type InvitationReviewDTO as InvitationPreviewDTO,
  type WorkspaceInvitationDTO as InvitationDTO,
} from '../../../backend/contexts/boards/modules/workspace/workspace.schema'

/** `POST /api/workspaces/:id/invitations`: admins only. */
export const InvitationCreateSchema = z.object({
  email: z.string().trim().pipe(z.email('Write an email address')),
})

/** `POST /api/invitations/:token/accept`: the workspace the person is now in. */
export const InvitationAcceptedSchema = z.object({
  workspaceId: z.string(),
})

export type InvitationStatus = WorkspaceInvitationDTO['status']
export type InvitationCreateDTO = z.input<typeof InvitationCreateSchema>
export type InvitationAcceptedDTO = z.infer<typeof InvitationAcceptedSchema>
