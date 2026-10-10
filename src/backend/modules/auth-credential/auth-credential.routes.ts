import type { Base } from '../../base/base'
import type { AuthCredential_Module } from './auth-credential.module'
import type { AuthCredentialChangeDTO } from './auth-credential.schema'

export function registerAuthCredentialRoutes(base: Base, credentials: AuthCredential_Module) {
  // The signed-in person's own password. The use case validates the body.
  base.http.post('/auth/credential/password', async request => {
    await credentials.change((await request.json()) as AuthCredentialChangeDTO)
    return new Response(null, { status: 204 })
  })
}
