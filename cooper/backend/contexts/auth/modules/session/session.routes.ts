import type { BunRequest } from 'bun'
import { clearSessionCookie, setSessionCookie } from '@newt-kit/newt/http'
import type { AuthBase } from '../../auth-base'
import { SIGN_IN_LIMIT, SIGN_UP_LIMIT } from '../../../../shared/rate-limits'
import type { Session_Module } from './session.module'
import { SessionCookie } from './session.schema'

export function registerSessionRoutes(base: AuthBase, sessions: Session_Module): void {
  /** The session lives in a cookie the page's scripts cannot read, sent only to auth. */
  const keep = (request: BunRequest, token: string) =>
    setSessionCookie(request, SessionCookie, token, { secure: sessions.options.secure, maxAgeSeconds: sessions.options.days * 24 * 60 * 60 })
  /** Clears it with the attributes it was set with. */
  const forget = (request: BunRequest) => clearSessionCookie(request, SessionCookie, { secure: sessions.options.secure })

  // The use cases validate every body.
  base.http.post('/session/sign-up', async request => {
    const { user, token } = await sessions.signUp(await request.json())
    keep(request, token)
    return Response.json(user, { status: 201 })
  }, { public: true, rateLimit: SIGN_UP_LIMIT })

  base.http.post('/session/sign-in', async request => {
    const { user, token } = await sessions.signIn(await request.json())
    keep(request, token)
    return Response.json(user)
  }, { public: true, rateLimit: SIGN_IN_LIMIT })

  // Public: signing out with a session already gone still clears the cookie.
  base.http.post('/session/sign-out', async request => {
    await sessions.signOut(request.cookies.get(SessionCookie) ?? undefined)
    forget(request)
    return new Response(null, { status: 204 })
  }, { public: true })

  base.http.get('/session', async () => Response.json(await sessions.me()))

  // Where an app sends the browser once it signed someone out of itself: auth's session
  // ends too, so signing in again asks who it is. The browser goes back to `redirect`
  // if it is an address of one of cooper's products, to auth's start otherwise.
  base.oauth.get('/oauth/logout', async request => {
    await sessions.signOut(request.cookies.get(SessionCookie) ?? undefined)
    forget(request)
    const location = await sessions.returnAddress(new URL(request.url).searchParams.get('redirect') ?? undefined)
    return new Response(null, { status: 302, headers: { location } })
  })
}
