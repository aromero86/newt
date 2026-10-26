import { z } from 'zod'

/**
 * Where an authorization request stands: `pending` until the person answers,
 * `approved` (a code given) or `denied`, then `redeemed` once the client traded its
 * code, or `replayed` if a code was brought twice.
 */
export const OauthGrantStatusSchema = z.enum(['pending', 'approved', 'denied', 'redeemed', 'replayed'])

/** An authorization request and its answer, as anyone sees it: never its code. */
export const OauthGrantSchema = z.object({
  id: z.uuidv7(),
  /** The client asking, by its `client_id`. */
  clientId: z.string().min(1),
  /** The product it asks access to. */
  productId: z.string().min(1),
  redirectUri: z.string().min(1),
  /** PKCE (RFC 7636): the S256 hash of the verifier only the client knows. */
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  /** What the client wants back as it sent it, to tie the answer to its request. */
  state: z.string().max(1000).nullable(),
  /** The server its tokens are for (RFC 8707): a product's MCP server; null for a product's own client. */
  resource: z.string().nullable(),
  /** A product's own client: the person only signs in, there is nothing to consent to. */
  firstParty: z.boolean(),
  status: OauthGrantStatusSchema,
  /** Who answered, once someone did. */
  userId: z.uuidv7().nullable(),
  /** Until when the request waits for an answer, and then its code for the client. */
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/**
 * A client asking for access (RFC 6749 §4.1.1 with PKCE), as `/oauth/authorize`
 * receives it. Checked in full by the use case, which says what is wrong.
 */
export const OauthGrantRequestSchema = z.object({
  responseType: z.string(),
  clientId: z.string().min(1, 'The request does not say which application asks'),
  redirectUri: z.string().min(1, 'The request does not say where to go back'),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  state: z.string().max(1000).optional(),
  resource: z.string().optional(),
})

/** What the auth UI shows of a pending request: who asks, for what, and whether the product takes new accounts. */
export const OauthGrantReviewSchema = z.object({
  id: z.uuidv7(),
  clientName: z.string(),
  product: z.object({ id: z.string(), name: z.string(), signUp: z.boolean() }),
  firstParty: z.boolean(),
  /** Where the browser goes back to, which the person may recognize. */
  redirectHost: z.string(),
  /** Still waiting for an answer: not answered, not expired. */
  open: z.boolean(),
})

/** Where the browser goes next: back to the client, with a code or a refusal. */
export const OauthGrantRedirectSchema = z.object({ redirectTo: z.string() })

/** A client trading its code (RFC 6749 §4.1.3, RFC 7636 §4.5), once `token` authenticated it. */
export const OauthGrantRedeemSchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, 'The code_verifier is not a valid one'),
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
})

/** What a redeemed code gives: whose access, for which client, product and server. */
export const OauthGrantRedeemedSchema = z.object({
  grantId: z.uuidv7(),
  userId: z.uuidv7(),
  clientId: z.string(),
  productId: z.string(),
  resource: z.string().nullable(),
})

export type OauthGrantStatus = z.infer<typeof OauthGrantStatusSchema>
export type OauthGrantDTO = z.infer<typeof OauthGrantSchema>
export type OauthGrantRequestDTO = z.input<typeof OauthGrantRequestSchema>
export type OauthGrantReviewDTO = z.infer<typeof OauthGrantReviewSchema>
export type OauthGrantRedirectDTO = z.infer<typeof OauthGrantRedirectSchema>
export type OauthGrantRedeemDTO = z.input<typeof OauthGrantRedeemSchema>
export type OauthGrantRedeemedDTO = z.infer<typeof OauthGrantRedeemedSchema>
