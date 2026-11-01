import type { BunRequest } from 'bun'
import { DomainError } from 'newt/core'
import { clearSessionCookie, setSessionCookie } from 'newt/http'
import type { CooperBase } from '../cooper-base'
import { ownPath, type WebSession_Module } from './web-session.module'
import type { WebSession_Options } from './web-session-options'
import { webSessionCookies, type WebSessionSignOutDTO } from './web-session.schema'

/** How long a sign-in may take, from leaving for auth to coming back. */
const SIGN_IN_SECONDS = 10 * 60

/** A redirect to a path of this same origin. */
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

export function registerWebSessionRoutes(base: CooperBase, sessions: WebSession_Module, options: WebSession_Options): void {
  const cookies = webSessionCookies(options.context)
  const secure = new URL(options.publicUrl).protocol === 'https:'

  // Every route of the context runs as whoever its session cookie says.
  base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(cookies.session) ?? undefined))

  base.http.get('/session/sign-in', async request => {
    const { location, pending } = await sessions.begin(new URL(request.url).searchParams.get('returnTo') ?? undefined)
    // Sent back only to the callback, and only for a while.
    setSessionCookie(request, cookies.signIn, pending, { secure, path: '/api/session', maxAgeSeconds: SIGN_IN_SECONDS })
    return redirect(location)
  }, { public: true })

  // Where auth sends the browser back. A sign-in that did not finish goes to the
  // frontend's start, which says why (`?signInError=<code>`).
  base.http.get('/session/callback', async request => {
    const query = new URL(request.url).searchParams
    const pending = request.cookies.get(cookies.signIn) ?? undefined
    clearSessionCookie(request, cookies.signIn, { secure, path: '/api/session' })
    try {
      const { token, returnTo } = await sessions.complete({
        code: query.get('code') ?? undefined,
        state: query.get('state') ?? undefined,
        error: query.get('error') ?? undefined,
        errorDescription: query.get('error_description') ?? undefined,
        pending,
      })
      keep(request, token)
      return redirect(returnTo)
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      return redirect(`/?${new URLSearchParams({ signInError: error.code })}`)
    }
  }, { public: true })

  base.http.get('/session', async () => Response.json(await sessions.me()))

  // Public: signing out with a session already gone still clears the cookie. The
  // browser goes on to auth, to sign out there too and come back: otherwise signing
  // in again would sign the same person in, with no way to switch accounts. It comes
  // back to `?returnTo=` (a path of this context: an invitation, say) or to the start.
  base.http.post('/session/sign-out', async request => {
    await sessions.signOut(request.cookies.get(cookies.session) ?? undefined)
    clearSessionCookie(request, cookies.session, { secure })
    const returnTo = new URL(request.url).searchParams.get('returnTo')
    const back = returnTo ? new URL(ownPath(returnTo), options.publicUrl).toString() : options.publicUrl
    const next = `${options.authUrl}/oauth/logout?${new URLSearchParams({ redirect: back })}`
    return Response.json({ next } satisfies WebSessionSignOutDTO)
  }, { public: true })

  /** The session lives in a cookie the page's scripts cannot read, sent only to this context. */
  function keep(request: BunRequest, token: string) {
    setSessionCookie(request, cookies.session, token, { secure, maxAgeSeconds: options.days * 24 * 60 * 60 })
  }
}
