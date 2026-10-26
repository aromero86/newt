import { InvitationApi, InvitationCreateSchema, type InvitationDTO } from '@cooper/api/invitation'
import { FormStore } from '@cooper/core/form/form-store'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'
import { toast } from '@cooper/ui/components/toast'

type InvitationsState = {
  items: InvitationDTO[]
  loaded: boolean
  failure: string | null
}

/**
 * A workspace's invitations: inviting by email, and revoking a link not used yet.
 * Its admin's only. A short list by design, so it comes whole.
 */
export class WorkspaceSettingsInvitationsService {

  private readonly api = inject(InvitationApi)
  private readonly store = new Store<InvitationsState>({ items: [], loaded: false, failure: null })
  private workspaceId = ''

  readonly items = this.store.select('items')
  readonly loaded = this.store.select('loaded')
  readonly failure = this.store.select('failure')

  readonly form = new FormStore(InvitationCreateSchema, { email: '' }, {
    errorFields: { validation: 'email' },
  })

  async load(workspaceId: string): Promise<void> {
    this.workspaceId = workspaceId
    this.store.patch({ loaded: false, failure: null })
    try {
      this.store.patch({ items: await this.api.list(workspaceId), loaded: true })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the invitations' })
    }
  }

  async invite(): Promise<void> {
    let sent: InvitationDTO | null = null
    await this.form.submit(async input => {
      const invitation = await this.api.invite(this.workspaceId, input)
      this.store.update(state => ({ items: [invitation, ...state.items] }))
      sent = invitation
    })
    if (sent) {
      this.form.reset({ email: '' })
      toast.success(`Invitation sent to ${(sent as InvitationDTO).email}`)
    }
  }

  async revoke(invitation: InvitationDTO): Promise<void> {
    try {
      await this.api.revoke(this.workspaceId, invitation.id)
      this.store.update(state => ({ items: state.items.map(each => (each.id === invitation.id ? { ...each, status: 'revoked' as const } : each)) }))
      toast.success(`The invitation to ${invitation.email} no longer works`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
