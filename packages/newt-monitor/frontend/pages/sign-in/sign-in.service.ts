import { FormStore, inject } from 'newt-kit-react'
import { SessionApi, SignInSchema } from '../../api/session'
import { SessionService } from '../../services/session/session.service'

/** Signing in with the monitor's one user and its password. */
export class SignInService {

  private readonly api = inject(SessionApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(SignInSchema, { user: '', password: '' }, {
    messages: { 'session.wrong_credentials': 'Incorrect user or password.' },
  })

  /** Resolves to whether they are now signed in. */
  submit(): Promise<boolean> {
    return this.form.submit(async credentials => this.session.signedIn(await this.api.signIn(credentials)))
  }
}
