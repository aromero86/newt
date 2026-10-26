import { z } from 'zod'

// Workspaces are auth's tenants, which boards' routes serve to its web app, in the
// shape boards' workspace module says.
export { WorkspaceSchema, type WorkspaceDTO } from '../../../backend/contexts/boards/modules/workspace/workspace.schema'

/** A workspace's name, as someone types it: auth checks it again. */
const name = z.string().trim().min(1, 'Give it a name').max(60, 'Keep it under 60 characters')

/** `POST /api/workspaces`. */
export const WorkspaceCreateSchema = z.object({ name })
/** `PATCH /api/workspaces/:id`: admins only. */
export const WorkspaceRenameSchema = z.object({ name })

export type WorkspaceCreateDTO = z.input<typeof WorkspaceCreateSchema>
export type WorkspaceRenameDTO = z.input<typeof WorkspaceRenameSchema>
