import { z } from 'zod'

// No backend schema yet: workspaces are auth's tenants, which boards' routes serve
// to its web app. This is the contract those routes keep.

/** A workspace as the signed-in person sees it: whether they are its admin. */
export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Its single admin: the user who created it. */
  adminId: z.string(),
  /** The signed-in person is its admin. */
  isAdmin: z.boolean(),
  createdAt: z.string(),
})

const name = z.string().trim().min(1, 'Give it a name').max(60, 'Keep it under 60 characters')

/** `POST /api/workspaces`. */
export const WorkspaceCreateSchema = z.object({ name })
/** `PATCH /api/workspaces/:id`: admins only. */
export const WorkspaceRenameSchema = z.object({ name })

export type WorkspaceDTO = z.infer<typeof WorkspaceSchema>
export type WorkspaceCreateDTO = z.input<typeof WorkspaceCreateSchema>
export type WorkspaceRenameDTO = z.input<typeof WorkspaceRenameSchema>
