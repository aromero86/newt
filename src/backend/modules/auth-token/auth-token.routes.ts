import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { AuthTokenCreateDTO } from './auth-token.schema'
import type { AuthToken_Module } from './auth-token.module'

export function registerAuthTokenRoutes(base: Base, tokens: AuthToken_Module) {
  // Always the signed-in person's own tokens; the use cases validate every body.
  base.http.get('/auth/tokens', async request => Response.json(await tokens.list(pageRequestFrom(request))))

  base.http.post('/auth/tokens', async request => Response.json(await tokens.create((await request.json()) as AuthTokenCreateDTO), { status: 201 }))

  base.http.delete('/auth/tokens/:tokenId', async request => {
    await tokens.revoke(request.params.tokenId!)
    return new Response(null, { status: 204 })
  })
}
