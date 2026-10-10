import type { BunRequest } from 'bun'
import type { Base } from '../../base/base'
import type { AuthSession_Module } from './auth-session.module'
import type { AuthSessionSignInDTO, AuthSessionSignUpDTO } from './auth-session.schema'

const COOKIE = 'newt_session'

export function registerAuthSessionRoutes(base: Base, sessions: AuthSession_Module) {
  /** The session lives in a cookie the page's scripts cannot read. */
  const keep = (request: BunRequest, token: string) => request.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessions.options.days * 24 * 60 * 60,
    secure: new URL(request.url).protocol === 'https:',
  })

  // The use cases validate every body.
  base.http.post('/auth/session/sign-up', async request => {
    const { user, token } = await sessions.signUp((await request.json()) as AuthSessionSignUpDTO)
    keep(request, token)
    return Response.json(user, { status: 201 })
  }, { public: true })

  base.http.post('/auth/session/sign-in', async request => {
    const { user, token } = await sessions.signIn((await request.json()) as AuthSessionSignInDTO)
    keep(request, token)
    return Response.json(user)
  }, { public: true })

  base.http.post('/auth/session/sign-out', async request => {
    await sessions.signOut()
    request.cookies.delete({ name: COOKIE, path: '/' })
    return new Response(null, { status: 204 })
  })

  base.http.get('/auth/session/me', async () => Response.json(await sessions.me()))
}
