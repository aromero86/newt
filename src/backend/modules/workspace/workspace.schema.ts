import { z } from 'zod'
import { WorkspaceMemberRoleSchema } from '../workspace-member/workspace-member.schema'

export const WorkspaceModuleName = 'workspace'

export const WorkspaceSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1, 'Name the workspace').max(80, 'Keep it under 80 characters'),
  description: z.string().max(500, 'Keep it under 500 characters'),
  createdBy: z.uuidv7(),
  archivedAt: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const WorkspaceCreateSchema = WorkspaceSchema.pick({ name: true }).extend({
  description: WorkspaceSchema.shape.description.default(''),
})
export const WorkspaceUpdateSchema = WorkspaceSchema.pick({ name: true, description: true }).partial()

/** A workspace as its member sees it: with their own role in it. */
export const WorkspaceMineSchema = WorkspaceSchema.extend({ myRole: WorkspaceMemberRoleSchema })

export type WorkspaceDTO = z.infer<typeof WorkspaceSchema>
export type WorkspaceCreateDTO = z.input<typeof WorkspaceCreateSchema>
export type WorkspaceUpdateDTO = z.infer<typeof WorkspaceUpdateSchema>
export type WorkspaceMineDTO = z.infer<typeof WorkspaceMineSchema>
