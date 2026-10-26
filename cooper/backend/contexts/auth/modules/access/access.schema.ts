import { z } from 'zod'

/** A tenant's single admin (who made it), or one of its members. */
export const AccessRoleSchema = z.enum(['admin', 'member'])

/**
 * Someone may enter a product: for one tenant (a member of a workspace of `cooper`)
 * or for all of it (`tenantId` null: the staff of `backoffice`).
 */
export const AccessSchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  productId: z.string().min(1),
  /** The tenant it is for; null when it is for the whole product. */
  tenantId: z.string().nullable(),
  role: AccessRoleSchema,
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** Whose access to what: a user, a product, and a tenant or none. */
export const AccessGrantSchema = z.object({
  userId: z.uuidv7(),
  productId: z.string().min(1),
  tenantId: z.string().min(1).nullable().default(null),
})

/** An access given by auth itself, once it checked who may have it: with its role. */
export const AccessAdmitSchema = AccessGrantSchema.extend({ role: AccessRoleSchema })

export type AccessRole = z.infer<typeof AccessRoleSchema>
export type AccessDTO = z.infer<typeof AccessSchema>
export type AccessGrantDTO = z.input<typeof AccessGrantSchema>
export type AccessAdmitDTO = z.input<typeof AccessAdmitSchema>
