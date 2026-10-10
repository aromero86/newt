import { z } from 'zod'

export const WorkspaceInvitationModuleName = 'workspaceInvitation'

export const WorkspaceInvitationCreateSchema = z.object({
  email: z.email('Write a valid email'),
})

/** A pending invitation, as its workspace's admins see it. */
export const WorkspaceInvitationSchema = z.object({
  id: z.uuidv7(),
  email: z.string(),
  invitedByNick: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
})

/** Inviting someone who already has an account adds them at once. */
export const WorkspaceInvitationResultSchema = z.object({ result: z.enum(['added', 'invited']) })

export type WorkspaceInvitationCreateDTO = z.infer<typeof WorkspaceInvitationCreateSchema>
export type WorkspaceInvitationDTO = z.infer<typeof WorkspaceInvitationSchema>
export type WorkspaceInvitationResultDTO = z.infer<typeof WorkspaceInvitationResultSchema>

/** What the invitation email needs. */
export type WorkspaceInvitationCreatedPayload = {
  email: string
  workspaceName: string
  inviterFullName: string
  expiresAt: string
}
