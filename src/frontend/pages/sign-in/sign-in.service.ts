import { SessionApi, SessionSignInSchema } from '@newt/api/session'
import { FormStore } from '../../core/form/form-store'
import { inject } from '../../core/injector/inject'
import { SessionService } from '../../services/session/session.service'

export class SignInService {

  private readonly api = inject(SessionApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(SessionSignInSchema, { login: '', password: '' })

  /** Resolves to whether the person is now signed in. */
  submit(): Promise<boolean> {
    return this.form.submit(async credentials => this.session.signedIn(await this.api.signIn(credentials)))
  }
}
