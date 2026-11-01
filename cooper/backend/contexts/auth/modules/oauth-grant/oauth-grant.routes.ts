import { DomainError, runAsActor } from '@newt-kit/newt/core'
import { toErrorResponse } from '@newt-kit/newt/http'
import { AUTHORIZE_LIMIT } from '../../../../shared/rate-limits'
import type { AuthBase } from '../../auth-base'
import { SessionCookie } from '../session/session.schema'
import type { OauthGrant_Deps } from './oauth-grant.deps'
import type { OauthGrant_Module } from './oauth-grant.module'
import type { OauthGrant_Options } from './oauth-grant-options'

export function registerOauthGrantRoutes(base: AuthBase, grants: OauthGrant_Module, deps: OauthGrant_Deps, options: OauthGrant_Options): void {
  // The authorization endpoint (RFC 6749 §3.1), where a client sends the browser. The
  // request is kept, and the browser goes on to auth's UI, which signs the person in
  // and asks them. A request auth cannot answer is shown there, never sent back to
  // an address nobody vouched for. Each one is a row, so each address leaves a few.
  base.oauth.get('/oauth/authorize', async request => {
    const query = new URL(request.url).searchParams
    const field = (name: string) => query.get(name) ?? undefined
    const { id } = await grants.request({
      responseType: field('response_type') ?? '',
      clientId: field('client_id') ?? '',
      redirectUri: field('redirect_uri') ?? '',
      codeChallenge: field('code_challenge') ?? '',
      codeChallengeMethod: field('code_challenge_method') ?? '',
      state: field('state'),
      resource: field('resource'),
    })
    return Response.redirect(`${options.publicUrl}/authorize/${id}`, 302)
  }, {
    rateLimit: AUTHORIZE_LIMIT,
    onError: error => error instanceof DomainError
      ? Response.redirect(`${options.publicUrl}/error?${new URLSearchParams({ message: error.message })}`, 302)
      : toErrorResponse(error),
  })

  // For auth's UI: what is asked, to anyone with its address; the answer, signed in.
  // Whoever is signed in to auth already is told upfront if the product refuses them.
  base.http.get('/authorizations/:id', async request => {
    const actor = await deps.session.authenticate(request.cookies.get(SessionCookie) ?? undefined)
    const review = () => grants.review(request.params.id)
    return Response.json(await (actor ? runAsActor(actor, review) : review()))
  }, { public: true })

  base.http.post('/authorizations/:id/approve', async request => Response.json(await grants.approve(request.params.id)))

  base.http.post('/authorizations/:id/deny', async request => Response.json(await grants.deny(request.params.id)))
}
