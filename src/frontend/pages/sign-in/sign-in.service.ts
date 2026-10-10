import { AuthSessionApi, AuthSessionSignInSchema } from '@newt/api/auth-session'
import { FormStore } from '../../core/form/form-store'
import { inject } from '../../core/injector/inject'
import { SessionService } from '../../services/session/session.service'

export class SignInService {

  private readonly api = inject(AuthSessionApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(AuthSessionSignInSchema, { login: '', password: '' })

  /** Resolves to whether the person is now signed in. */
  submit(): Promise<boolean> {
    return this.form.submit(async credentials => this.session.signedIn(await this.api.signIn(credentials)))
  }
}
