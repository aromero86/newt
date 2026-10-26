import { z } from 'zod'

// No backend schema yet: members are auth's access to a tenant, which boards' routes
// serve to its web app. This is the contract those routes keep.

/** Someone in a workspace. */
export const WorkspaceMemberSchema = z.object({
  /** Their user's id, in auth: what a card's `assigneeId` holds. */
  id: z.string(),
  name: z.string(),
  email: z.string(),
  /** The workspace's single admin, who cannot be removed. */
  isAdmin: z.boolean(),
})

export type WorkspaceMemberDTO = z.infer<typeof WorkspaceMemberSchema>
