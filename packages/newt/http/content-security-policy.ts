/**
 * The pages' Content-Security-Policy, by directive: `serve`'s `csp`. Each directive
 * given replaces newt's, and `null` leaves it out; `false` sends none but that no page
 * is framed (`frame-ancestors 'none'`).
 */
export type ContentSecurityPolicy = Record<string, string[] | null>

/**
 * newt's, for a frontend Bun built: its scripts, styles, fonts and images from its own
 * origin (and images and fonts inlined), its requests to its own API, no plugins, and
 * never framed. Styles may be inline (`style` attributes, a chart's colors); an inline
 * script runs only if its hash is in the policy, which the page's own get.
 */
export const CONTENT_SECURITY_POLICY: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'frame-ancestors': ["'none'"],
}

/** What no page goes without, whatever the policy: it is never shown inside someone else's. */
const NEVER_FRAMED = "frame-ancestors 'none'"

/** The policy of a page, from what `serve` was told and the hashes of the page's inline scripts. */
export function policyOf(own: ContentSecurityPolicy | false | undefined, inlineScripts: string[]): string {
  if (own === false) return NEVER_FRAMED
  const directives: Record<string, readonly string[] | null> = { ...CONTENT_SECURITY_POLICY, ...own }
  if (directives['script-src'] && inlineScripts.length > 0) directives['script-src'] = [...directives['script-src'], ...inlineScripts]
  return Object.entries(directives)
    .filter((entry): entry is [string, readonly string[]] => entry[1] !== null)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ')
}

/** The hash of each inline script of a page (`'sha256-…'`), for its policy to let them run. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]!)
    .filter(script => script.trim().length > 0)
    .map(script => `'sha256-${new Bun.CryptoHasher('sha256').update(script).digest('base64')}'`)
}
