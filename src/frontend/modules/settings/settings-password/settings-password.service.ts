import { CredentialApi, CredentialChangeSchema } from '@newt/api/credential'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'

/** The backend's rule, plus typing the new password twice. */
const PasswordFormSchema = CredentialChangeSchema.extend({ confirmPassword: CredentialChangeSchema.shape.newPassword })
  .refine(form => form.newPassword === form.confirmPassword, { path: ['confirmPassword'], message: 'The passwords do not match' })

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' }

export class SettingsPasswordService {

  private readonly api = inject(CredentialApi)

  readonly form = new FormStore(PasswordFormSchema, EMPTY, {
    errorFields: { 'credential.wrong_password': 'currentPassword' },
  })

  async change(): Promise<void> {
    const changed = await this.form.submit(({ currentPassword, newPassword }) => this.api.change({ currentPassword, newPassword }))
    if (changed) {
      this.form.reset(EMPTY)
      toast.success('Password changed. Your other sessions were signed out.')
    }
  }
}
