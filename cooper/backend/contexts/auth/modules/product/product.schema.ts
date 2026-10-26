import { z } from 'zod'

/**
 * The ids of cooper's products, which other contexts name when they ask auth about
 * them: `cooper` (the boards) and `backoffice` (the staff's console).
 */
export const PRODUCTS = { cooper: 'cooper', backoffice: 'backoffice' } as const

/** The product whose workspaces the tenants are: boards, the SaaS. */
export const WORKSPACES_PRODUCT = PRODUCTS.cooper

/**
 * An app of cooper that signs people in through auth, as cooper's code declares it:
 * `cooper` (the boards) and `backoffice` (the staff's console).
 */
export const ProductSchema = z.object({
  /** Its name in cooper's code. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** What people are shown when they sign in to it. */
  name: z.string().min(1),
  /** Where people open it. */
  publicUrl: z.url(),
  /** Whether someone without an account may make one on the way to it. */
  signUp: z.boolean(),
})

export type ProductDTO = z.infer<typeof ProductSchema>
