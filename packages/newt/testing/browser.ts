/** A request as a test's browser sends it: `json` is sent as the body, as JSON. */
export type BrowserRequest = RequestInit & { json?: unknown }

/** What `browser()` gives: `fetch`, with the browser's cookies. */
export type Browser = (address: string, init?: BrowserRequest) => Promise<Response>

/**
 * One person's browser, for a test: it keeps each host's cookies, sends them back,
 * forgets those a server deletes, and never follows a redirect on its own, so the
 * test sees where it goes. An address may be relative to `baseUrl`.
 *
 * ```ts
 * const as = browser(authUrl)
 * await as('/api/session/sign-in', { method: 'POST', json: { email, password } })
 * expect((await as('/api/session')).status).toBe(200)
 * ```
 */
export function browser(baseUrl?: string): Browser {
  const jars = new Map<string, Map<string, string>>()
  return async (address, init = {}) => {
    const { json, ...rest } = init
    const target = new URL(address, baseUrl)
    const jar = jars.get(target.host) ?? new Map<string, string>()
    jars.set(target.host, jar)

    const headers = new Headers(rest.headers)
    if (jar.size) headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
    if (json !== undefined) headers.set('content-type', 'application/json')
    const response = await fetch(target, { ...rest, headers, redirect: 'manual', body: json === undefined ? rest.body : JSON.stringify(json) })

    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(';').map(part => part.trim())
      const [name = '', value = ''] = pair!.split(/=(.*)/s)
      if (value === '' || attributes.some(gone)) jar.delete(name)
      else jar.set(name, value)
    }
    return response
  }
}

/** An attribute that deletes the cookie: no age left, or an expiry already past. */
function gone(attribute: string): boolean {
  const [name = '', value = ''] = attribute.split('=')
  if (name.toLowerCase() === 'max-age') return Number(value) <= 0
  if (name.toLowerCase() === 'expires') return Date.parse(value) <= Date.now()
  return false
}
