import { AuthCredentialPasswordSchema } from '@newt/api/auth-credential'
import { AuthPasswordResetApi } from '@newt/api/auth-password-reset'
import { z } from 'zod'
import { FormStore } from '../../core/form/form-store'
import { inject } from '../../core/injector/inject'

/** The backend's password rule, plus typing it twice. */
const ResetFormSchema = z
  .object({ password: AuthCredentialPasswordSchema, confirmPassword: AuthCredentialPasswordSchema })
  .refine(form => form.password === form.confirmPassword, { path: ['confirmPassword'], message: 'The passwords do not match' })

export class ResetPasswordService {

  private readonly api = inject(AuthPasswordResetApi)

  readonly form = new FormStore(ResetFormSchema, { password: '', confirmPassword: '' })

  /** Resolves to whether the new password is set. `token` comes from the emailed link. */
  submit(token: string): Promise<boolean> {
    return this.form.submit(({ password }) => this.api.complete({ token, password }))
  }
}
