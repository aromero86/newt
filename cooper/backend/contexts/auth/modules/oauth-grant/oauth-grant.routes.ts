import { DomainError } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import type { OauthGrant_Module } from './oauth-grant.module'
import type { OauthGrant_Options } from './oauth-grant-options'

export function registerOauthGrantRoutes(base: AuthBase, grants: OauthGrant_Module, options: OauthGrant_Options): void {
  // The authorization endpoint (RFC 6749 §3.1), where a client sends the browser. The
  // request is kept, and the browser goes on to auth's UI, which signs the person in
  // and asks them. A request auth cannot answer is shown there, never sent back to
  // an address nobody vouched for.
  base.oauth.get('/authorize', async request => {
    const query = new URL(request.url).searchParams
    const field = (name: string) => query.get(name) ?? undefined
    try {
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
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      return Response.redirect(`${options.publicUrl}/error?${new URLSearchParams({ message: error.message })}`, 302)
    }
  }, { public: true })

  // For auth's UI: what is asked, to anyone with its address; the answer, signed in.
  base.http.get('/authorizations/:id', async request => Response.json(await grants.review(request.params.id)), { public: true })

  base.http.post('/authorizations/:id/approve', async request => Response.json(await grants.approve(request.params.id)))

  base.http.post('/authorizations/:id/deny', async request => Response.json(await grants.deny(request.params.id)))
}
