import type { Base } from '../../base/base'
import type { Credential_Module } from './credential.module'
import type { CredentialChangeDTO } from './credential.schema'

export function registerCredentialRoutes(base: Base, credentials: Credential_Module) {
  // The signed-in person's own password. The use case validates the body.
  base.http.post('/credential/password', async request => {
    await credentials.change((await request.json()) as CredentialChangeDTO)
    return new Response(null, { status: 204 })
  })
}
