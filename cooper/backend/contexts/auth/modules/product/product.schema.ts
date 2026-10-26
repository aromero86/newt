import { z } from 'zod'

/** Who may enter a product: anyone with an account, or only those given access to it. */
export const ProductAccessSchema = z.enum(['anyone', 'granted'])

/**
 * An app of cooper that signs people in through auth, as cooper's code declares it:
 * `cooper` (the boards) and `backoffice` (the staff's console). Each one is an OAuth
 * confidential client of auth, whose `client_id` is the product's id.
 */
export const ProductSchema = z.object({
  /** Its name in cooper's code, and its OAuth client_id. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** What people are shown when they sign in to it. */
  name: z.string().min(1),
  /** Where people open it. */
  publicUrl: z.url(),
  /** Whether someone without an account may make one on the way to it. */
  signUp: z.boolean(),
  access: ProductAccessSchema,
  /** Its MCP server, if it has one: the resource (RFC 8707) the tokens of MCP clients are for. */
  mcpResource: z.url().nullable(),
  /** Where its OAuth client receives the codes it signs people in with. */
  redirectUri: z.url(),
})

export type ProductAccess = z.infer<typeof ProductAccessSchema>
export type ProductDTO = z.infer<typeof ProductSchema>
