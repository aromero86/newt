import { SIGN_IN_LIMIT, SIGN_IN_TOTAL_LIMIT } from '../../../../shared/rate-limits'
import type { AuthBase } from '../../auth-base'
import { SESSION_COOKIE } from './session.schema'
import type { Session_Module } from './session.module'
import type { Session_Options } from './session-options'

export function registerSessionRoutes(base: AuthBase, sessions: Session_Module, options: Session_Options): void {
  // Every route of the context runs as whoever its session cookie says: none, a 401.
  base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(SESSION_COOKIE) ?? undefined))

  // Signing in: the token goes in a cookie the page's scripts cannot read, sent only to
  // this origin. Each address guesses slowly, and all of them together too.
  base.http.post('/session', async request => {
    const { token, me } = await sessions.signIn(await request.json())
    request.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: options.secureCookie, path: '/', maxAge: options.hours * 60 * 60 })
    return Response.json(me)
  }, { public: true, rateLimit: [SIGN_IN_TOTAL_LIMIT, SIGN_IN_LIMIT] })

  base.http.get('/session', async () => Response.json(await sessions.me()))

  // Public: signing out with a session already gone still clears the cookie.
  base.http.delete('/session', async request => {
    await sessions.signOut(request.cookies.get(SESSION_COOKIE) ?? undefined)
    request.cookies.delete({ name: SESSION_COOKIE, path: '/' })
    return new Response(null, { status: 204 })
  }, { public: true })
}
