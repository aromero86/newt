import { SessionApi } from '@cooper/api/session'
import { UserSignUpSchema } from '@cooper/api/user'
import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { SessionService } from '../../services/session/session.service'

/** Making an account, signed in at once. */
export class SignUpService {

  private readonly api = inject(SessionApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(UserSignUpSchema, { email: '', name: '', password: '' }, { errorFields: { 'user.email_taken': 'email' } })

  /** For the product the person is on the way to, if any. Resolves to whether they are now signed in. */
  submit(productId: string | undefined): Promise<boolean> {
    return this.form.submit(async account => this.session.signedIn(await this.api.signUp({ ...account, productId })))
  }
}
