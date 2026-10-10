import { AuthPasswordResetApi, AuthPasswordResetRequestSchema } from '@newt/api/auth-password-reset'
import { FormStore } from '../../core/form/form-store'
import { inject } from '../../core/injector/inject'
import { Store } from '../../core/store/store'

export class ForgotPasswordService {

  private readonly api = inject(AuthPasswordResetApi)
  private readonly store = new Store({ sent: false })

  readonly form = new FormStore(AuthPasswordResetRequestSchema, { email: '' })
  /** The request went out. The answer is the same whether the email has an account or not. */
  readonly sent = this.store.select('sent')

  async submit(): Promise<void> {
    if (await this.form.submit(request => this.api.request(request))) this.store.patch({ sent: true })
  }
}
