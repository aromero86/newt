import { UserApi, UserCreateSchema } from '@newt/api/user'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { SessionService } from '../../../services/session/session.service'

// The same fields as signing up: the email as typed, which the backend normalizes.
const ProfileSchema = UserCreateSchema

/** The signed-in person's profile, being edited. The session stays the owner of the saved one. */
export class SettingsProfileService {

  private readonly api = inject(UserApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(ProfileSchema, this.saved(), {
    errorFields: { 'user.nick_taken': 'nick', 'user.email_taken': 'email' },
  })

  async save(): Promise<void> {
    const saved = await this.form.submit(async profile => this.session.replaceUser(await this.api.updateMine(profile)))
    if (saved) {
      this.form.reset(this.saved())
      toast.success('Profile saved')
    }
  }

  private saved() {
    const user = this.session.user.peek()
    return { nick: user?.nick ?? '', fullName: user?.fullName ?? '', email: user?.email ?? '', bio: user?.bio ?? '' }
  }
}
