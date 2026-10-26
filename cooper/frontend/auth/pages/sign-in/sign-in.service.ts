import { SessionApi, SessionSignInSchema } from '@cooper/api/session'
import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { SessionService } from '../../services/session/session.service'

/** Signing in with an email and a password. */
export class SignInService {

  private readonly api = inject(SessionApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(SessionSignInSchema, { email: '', password: '' })

  /** Resolves to whether the person is now signed in. */
  submit(): Promise<boolean> {
    return this.form.submit(async credentials => this.session.signedIn(await this.api.signIn(credentials)))
  }
}
