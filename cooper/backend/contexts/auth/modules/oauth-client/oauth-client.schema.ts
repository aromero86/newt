import { z } from 'zod'

/** Loopback addresses: where a native client on the person's own computer listens. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

/**
 * Where a client receives its codes: https, or http only on the person's own
 * computer. Never with a fragment, which the code could not travel in.
 */
export const OauthClientRedirectUriSchema = z.url('Write a valid address').refine(uri => {
  const url = new URL(uri)
  if (url.hash) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname))
}, 'A redirect address is https, or http on localhost')

/**
 * An OAuth client, as auth knows it: a product's own (confidential: it has a secret)
 * or one that registered itself (public: it proves itself with PKCE only).
 */
export const OauthClientSchema = z.object({
  id: z.uuidv7(),
  /** What it goes by in OAuth (`client_id`): its product's id, or its own id. */
  clientId: z.string().min(1),
  name: z.string().min(1).max(80),
  redirectUris: z.array(OauthClientRedirectUriSchema).min(1).max(10),
  /** The product it signs people in to, for a product's own client; null for anyone else's. */
  productId: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** Dynamic client registration (RFC 7591): what auth takes of what a client says about itself. */
export const OauthClientRegisterSchema = z.object({
  name: z.string().trim().max(80, 'Use at most 80 characters').optional(),
  redirectUris: z.array(OauthClientRedirectUriSchema).min(1, 'A client needs a redirect address').max(10, 'Use at most 10 addresses'),
})

export type OauthClientDTO = z.infer<typeof OauthClientSchema>
export type OauthClientRegisterDTO = z.input<typeof OauthClientRegisterSchema>
