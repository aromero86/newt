import { z } from 'zod'
import { defineFilter } from 'newt/core'

/**
 * A workspace of `cooper`: every other context keeps what it needs of it by its id
 * (boards calls it a workspace). Its admin is who made it, and only them.
 */
export const TenantSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1, 'Give the workspace a name').max(60, 'Use at most 60 characters'),
  /** Who made it: its single admin. */
  createdBy: z.uuidv7(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const TenantCreateSchema = TenantSchema.pick({ name: true })
export const TenantRenameSchema = TenantSchema.pick({ name: true })

/** What the staff may look workspaces up by: these fields, these operators, nothing else. */
export const TenantFilter = defineFilter({
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  admin: { field: 'createdBy', value: z.string(), ops: ['eq', 'in'] },
  created: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })

export type TenantDTO = z.infer<typeof TenantSchema>
export type TenantCreateDTO = z.input<typeof TenantCreateSchema>
export type TenantRenameDTO = z.input<typeof TenantRenameSchema>
/** A search of workspaces as a client sends it. */
export type TenantFilterDTO = z.infer<typeof TenantFilter.schema>
