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
  redirectUri: z.string().min(1),
  /** PKCE (RFC 7636): the S256 hash of the verifier only the client knows. */
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  /** What the client wants back as it sent it, to tie the answer to its request. */
  state: z.string().max(1000).nullable(),
  /** The server its tokens are for (RFC 8707): the monitor's MCP server. */
  resource: z.string().min(1),
  status: OauthGrantStatusSchema,
  /** Who answered, once someone did: the monitor's one person. */
  userId: z.string().min(1).nullable(),
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
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  state: z.string().max(1000).optional(),
  resource: z.string().optional(),
})

/**
 * Why a client's request cannot be answered, by the code of its error, and what the
 * person is told: the monitor's error page shows these and nothing taken from its address.
 */
export const AUTHORIZATION_REQUEST_PROBLEMS = {
  'oauthGrant.invalid_request': 'The request is not a valid one',
  'oauthGrant.missing_client': 'The request does not say which application asks',
  'oauthGrant.missing_redirect': 'The request does not say where to go back',
  'oauthGrant.unknown_client': 'This application is not registered in the monitor',
  'oauthGrant.redirect_mismatch': 'The address to go back to is not one of this application',
  'oauthGrant.unsupported_response_type': 'The application asks for a kind of access the monitor does not give',
  'oauthGrant.pkce_required': 'The application does not protect its request with PKCE (S256)',
  'oauthGrant.unknown_resource': 'The application asks for access to a server the monitor does not have',
} as const

/** What the monitor's consent page shows of a request: who asks, and where the browser goes back to. */
export const OauthGrantReviewSchema = z.object({
  id: z.uuidv7(),
  clientName: z.string(),
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

/** What a redeemed code gives: whose access, for which client and server. */
export const OauthGrantRedeemedSchema = z.object({
  grantId: z.uuidv7(),
  userId: z.string().min(1),
  clientId: z.string(),
  resource: z.string(),
})

export type AuthorizationRequestProblem = keyof typeof AUTHORIZATION_REQUEST_PROBLEMS
export type OauthGrantStatus = z.infer<typeof OauthGrantStatusSchema>
export type OauthGrantDTO = z.infer<typeof OauthGrantSchema>
export type OauthGrantRequestDTO = z.input<typeof OauthGrantRequestSchema>
export type OauthGrantReviewDTO = z.infer<typeof OauthGrantReviewSchema>
export type OauthGrantRedirectDTO = z.infer<typeof OauthGrantRedirectSchema>
export type OauthGrantRedeemDTO = z.input<typeof OauthGrantRedeemSchema>
export type OauthGrantRedeemedDTO = z.infer<typeof OauthGrantRedeemedSchema>
