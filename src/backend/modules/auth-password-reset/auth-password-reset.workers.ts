import type { AuthPasswordReset_Deps } from './auth-password-reset.deps'
import type { AuthPasswordReset_Module } from './auth-password-reset.module'
import { AuthPasswordResetEmail } from './value-objects/auth-password-reset-email'

export function registerAuthPasswordResetWorkers(resets: AuthPasswordReset_Module, deps: AuthPasswordReset_Deps) {
  // The email leaves after the request committed, outside its transaction.
  resets.requested.subscribe(request =>
    deps.mail.send(AuthPasswordResetEmail.from({ request, publicUrl: resets.options.publicUrl, minutes: resets.options.minutes })))
}
