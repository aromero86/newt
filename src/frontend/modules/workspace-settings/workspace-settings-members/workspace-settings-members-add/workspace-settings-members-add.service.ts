import { WorkspaceInvitationApi } from '@newt/api/workspace-invitation'
import { WorkspaceMemberApi } from '@newt/api/workspace-member'
import { toast } from '@newt/ui/components/toast'
import { z } from 'zod'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { WorkspaceSettingsService } from '../../workspace-settings.service'

const AddSchema = z.object({ login: z.string().trim().min(1, 'Write a nick or an email') })

/**
 * Brings someone in by nick or by email. An email goes to the invitations, which
 * add the person at once if they have an account, or invite them if not.
 */
export class WorkspaceSettingsMembersAddService {

  private readonly memberApi = inject(WorkspaceMemberApi)
  private readonly invitationApi = inject(WorkspaceInvitationApi)
  private readonly settings = inject(WorkspaceSettingsService)

  readonly form = new FormStore(AddSchema, { login: '' }, {
    errorFields: {
      'workspaceMember.no_such_nick': 'login',
      'workspaceMember.already_member': 'login',
      validation: 'login',
    },
  })

  async submit(): Promise<void> {
    let done = ''
    const added = await this.form.submit(async ({ login }) => {
      const workspaceId = this.settings.workspaceId
      if (login.includes('@')) {
        const { result } = await this.invitationApi.invite(workspaceId, { email: login })
        done = result === 'added' ? `${login} has an account: they are in` : `Invitation sent to ${login}`
      } else {
        const nick = login.replace(/^@/, '')
        await this.memberApi.add(workspaceId, { nick })
        done = `@${nick} is in`
      }
    })
    if (added) {
      this.form.reset({ login: '' })
      toast.success(done)
      await this.settings.reload()
    }
  }
}
