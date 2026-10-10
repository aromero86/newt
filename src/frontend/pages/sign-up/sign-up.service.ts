import { SessionApi, SessionSignUpSchema } from '@newt/api/session'
import { FormStore } from '../../core/form/form-store'
import { inject } from '../../core/injector/inject'
import { SessionService } from '../../services/session/session.service'

export class SignUpService {

  private readonly api = inject(SessionApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(
    SessionSignUpSchema,
    { nick: '', fullName: '', email: '', password: '', bio: '' },
    { errorFields: { 'user.nick_taken': 'nick', 'user.email_taken': 'email' } },
  )

  /** Resolves to whether the account exists and is signed in. */
  submit(): Promise<boolean> {
    return this.form.submit(async account => this.session.signedIn(await this.api.signUp(account)))
  }
}
