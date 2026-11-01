import { DomainError } from 'newt-kit/core'
import { toErrorResponse } from 'newt-kit/http'
import { AUTHORIZE_LIMIT } from '../../../../shared/rate-limits'
import type { AuthBase } from '../../auth-base'
import type { OauthGrant_Module } from './oauth-grant.module'
import type { OauthGrant_Options } from './oauth-grant-options'

export function registerOauthGrantRoutes(base: AuthBase, grants: OauthGrant_Module, options: OauthGrant_Options): void {
  // The authorization endpoint (RFC 6749 §3.1), where a client sends the browser. The
  // request is kept, and the browser goes on to the monitor's consent page, which signs
  // the person in and asks them. A request the monitor cannot answer is shown there by
  // its error's code, never sent back to an address nobody vouched for. Each one is a
  // row, so each address leaves a few.
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
      ? Response.redirect(`${options.publicUrl}/authorize/error?${new URLSearchParams({ error: error.code })}`, 302)
      : toErrorResponse(error),
  })

  // For the consent page, signed in: what is asked, and the answer.
  base.http.get('/authorizations/:id', async request => Response.json(await grants.review(request.params.id)))

  base.http.post('/authorizations/:id/approve', async request => Response.json(await grants.approve(request.params.id)))

  base.http.post('/authorizations/:id/deny', async request => Response.json(await grants.deny(request.params.id)))
}
