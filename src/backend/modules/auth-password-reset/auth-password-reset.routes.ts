import type { Base } from '../../base/base'
import type { AuthPasswordReset_Module } from './auth-password-reset.module'
import type { AuthPasswordResetCompleteDTO, AuthPasswordResetRequestDTO } from './auth-password-reset.schema'

export function registerAuthPasswordResetRoutes(base: Base, resets: AuthPasswordReset_Module) {
  // Both are public: whoever forgot their password cannot sign in. The use cases validate the bodies.
  base.http.post('/auth/password-reset', async request => {
    await resets.request((await request.json()) as AuthPasswordResetRequestDTO)
    return new Response(null, { status: 204 })
  }, { public: true })

  base.http.post('/auth/password-reset/complete', async request => {
    await resets.complete((await request.json()) as AuthPasswordResetCompleteDTO)
    return new Response(null, { status: 204 })
  }, { public: true })
}
