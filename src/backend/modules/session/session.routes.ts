import type { BunRequest } from 'bun'
import type { Base } from '../../base/base'
import type { Session_Module } from './session.module'
import type { SessionSignInDTO, SessionSignUpDTO } from './session.schema'

const COOKIE = 'newt_session'

export function registerSessionRoutes(base: Base, sessions: Session_Module) {
  /** The session lives in a cookie the page's scripts cannot read. */
  const keep = (request: BunRequest, token: string) => request.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessions.options.days * 24 * 60 * 60,
    secure: new URL(request.url).protocol === 'https:',
  })

  // The use cases validate every body.
  base.http.post('/session/sign-up', async request => {
    const { user, token } = await sessions.signUp((await request.json()) as SessionSignUpDTO)
    keep(request, token)
    return Response.json(user, { status: 201 })
  }, { public: true })

  base.http.post('/session/sign-in', async request => {
    const { user, token } = await sessions.signIn((await request.json()) as SessionSignInDTO)
    keep(request, token)
    return Response.json(user)
  }, { public: true })

  base.http.post('/session/sign-out', async request => {
    await sessions.signOut()
    request.cookies.delete({ name: COOKIE, path: '/' })
    return new Response(null, { status: 204 })
  })

  base.http.get('/session/me', async () => Response.json(await sessions.me()))
}
