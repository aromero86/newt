/**
 * The headers every answer of a server carries unless it says otherwise, a route's own
 * first: `serve`'s `securityHeaders`. Each one given replaces newt's, and `null` leaves
 * it out; `false` sends none of them.
 */
export type SecurityHeaders = Record<string, string | null>

/** HSTS, `serve`'s `hsts`: browsers come back only over HTTPS for `maxAgeSeconds` (a year unless told). */
export type Hsts = { maxAgeSeconds?: number, includeSubDomains?: boolean, preload?: boolean }

const YEAR_SECONDS = 365 * 24 * 60 * 60

/**
 * newt's: a file is never taken for another type than it says (`nosniff`), another site
 * is told only the origin a link was followed from, and no answer is shown inside
 * someone else's page.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
}

/** The headers every answer carries, from what `serve` was told. */
export function securityHeadersOf(own: SecurityHeaders | false | undefined, hsts: Hsts | boolean | undefined): Record<string, string> {
  const headers: Record<string, string | null> = own === false ? {} : { ...SECURITY_HEADERS, ...own }
  if (hsts) {
    const { maxAgeSeconds = YEAR_SECONDS, includeSubDomains = false, preload = false } = hsts === true ? {} : hsts
    headers['strict-transport-security'] ??= [`max-age=${maxAgeSeconds}`, includeSubDomains && 'includeSubDomains', preload && 'preload'].filter(Boolean).join('; ')
  }
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null).map(([name, value]) => [name.toLowerCase(), value]))
}

/** An answer with the headers it does not have yet: its own come first. */
export function withHeaders(response: Response, headers: Record<string, string>): Response {
  const missing = Object.entries(headers).filter(([name]) => !response.headers.has(name))
  if (missing.length === 0) return response
  // A Response.redirect's headers cannot change: a copy's can.
  const told = new Response(response.body, response)
  for (const [name, value] of missing) told.headers.set(name, value)
  return told
}
