import { z } from 'zod'

/**
 * What a grant was traded for: an access token and a refresh token, opaque, kept as
 * hashes. One per grant, rotated in place on every refresh. As anyone sees it: never
 * its hashes.
 */
export const TokenSchema = z.object({
  id: z.uuidv7(),
  grantId: z.uuidv7(),
  userId: z.uuidv7(),
  clientId: z.string().min(1),
  productId: z.string().min(1),
  /** The server it opens (RFC 8707): a product's MCP server; null for a product's own client. */
  resource: z.string().nullable(),
  accessExpiresAt: z.iso.datetime(),
  refreshExpiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** Who asks at the token endpoint: a client, and its secret when it is a confidential one. */
const TokenClientSchema = z.object({
  clientId: z.string().min(1, 'The request does not say which client sends it'),
  clientSecret: z.string().optional(),
})

/** A client trading its code for tokens (RFC 6749 §4.1.3). */
export const TokenExchangeSchema = TokenClientSchema.extend({
  code: z.string().min(1, 'The request has no code'),
  codeVerifier: z.string().min(1, 'The request has no code_verifier'),
  redirectUri: z.string().min(1, 'The request has no redirect_uri'),
})

/** A client trading its refresh token for new tokens (RFC 6749 §6). */
export const TokenRefreshSchema = TokenClientSchema.extend({
  refreshToken: z.string().min(1, 'The request has no refresh_token'),
})

/** A client giving a token back (RFC 7009): an access token or a refresh token, either revokes both. */
export const TokenRevokeSchema = TokenClientSchema.extend({
  token: z.string().min(1, 'The request has no token'),
})

/** What the client holds: the only time anyone sees the tokens. */
export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Seconds the access token works. */
  expiresIn: z.number().int(),
})

/** Who an access token acts for: what a context asks before it lets a request in. */
export const TokenVerifiedSchema = z.object({
  userId: z.uuidv7(),
  clientId: z.string(),
  productId: z.string(),
  resource: z.string().nullable(),
  expiresAt: z.iso.datetime(),
})

export type TokenDTO = z.infer<typeof TokenSchema>
export type TokenExchangeDTO = z.input<typeof TokenExchangeSchema>
export type TokenRefreshDTO = z.input<typeof TokenRefreshSchema>
export type TokenRevokeDTO = z.input<typeof TokenRevokeSchema>
export type TokenPairDTO = z.infer<typeof TokenPairSchema>
export type TokenVerifiedDTO = z.infer<typeof TokenVerifiedSchema>
