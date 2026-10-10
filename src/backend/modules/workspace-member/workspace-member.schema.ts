import { z } from 'zod'

export const WorkspaceMemberModuleName = 'workspaceMember'

export const WorkspaceMemberRoleSchema = z.enum(['admin', 'member'])

/** A member as the workspace shows them: who they are, their role, and whether they are still in. */
export const WorkspaceMemberSchema = z.object({
  /** The membership: also the cursor of the members list. */
  id: z.uuidv7(),
  userId: z.uuidv7(),
  nick: z.string(),
  fullName: z.string(),
  role: WorkspaceMemberRoleSchema,
  active: z.boolean(),
  since: z.string(),
})

export const WorkspaceMemberAddSchema = z.object({
  /** The person's nick. To add someone by email, invite them. */
  nick: z.string().trim().min(1, 'Write a nick'),
})

export const WorkspaceMemberRoleChangeSchema = z.object({ role: WorkspaceMemberRoleSchema })

export type WorkspaceMemberRole = z.infer<typeof WorkspaceMemberRoleSchema>
export type WorkspaceMemberDTO = z.infer<typeof WorkspaceMemberSchema>
export type WorkspaceMemberAddDTO = z.infer<typeof WorkspaceMemberAddSchema>
export type WorkspaceMemberRoleChangeDTO = z.infer<typeof WorkspaceMemberRoleChangeSchema>
