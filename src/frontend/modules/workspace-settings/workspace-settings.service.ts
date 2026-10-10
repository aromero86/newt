import { WorkspaceInvitationApi, type WorkspaceInvitationDTO } from '@newt/api/workspace-invitation'
import { WorkspaceMemberApi, type WorkspaceMemberDTO, type WorkspaceMemberRole } from '@newt/api/workspace-member'
import { toast } from '@newt/ui/components/toast'
import { inject } from '../../core/injector/inject'
import { ListStore } from '../../core/list/list-store'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** A workspace's people: its members and, for admins, its pending invitations, page by page. */
export class WorkspaceSettingsService {

  private readonly memberApi = inject(WorkspaceMemberApi)
  private readonly invitationApi = inject(WorkspaceInvitationApi)
  private readonly workspaces = inject(WorkspacesService)
  private current = { workspaceId: '', admin: false }

  readonly members = new ListStore<WorkspaceMemberDTO>(page => this.memberApi.list(this.workspaceId, page))
  readonly invitations = new ListStore<WorkspaceInvitationDTO>(page => this.invitationApi.pending(this.workspaceId, page))

  get workspaceId(): string {
    return this.current.workspaceId
  }

  async load(workspaceId: string, admin: boolean): Promise<void> {
    this.current = { workspaceId, admin }
    await this.reload()
  }

  /** From the first page again: after someone was added, invited or removed. */
  async reload(): Promise<void> {
    await Promise.all([this.members.loadFirstPage(), this.current.admin ? this.invitations.loadFirstPage() : Promise.resolve()])
  }

  async changeRole(member: WorkspaceMemberDTO, role: WorkspaceMemberRole): Promise<void> {
    await this.attempt(() => this.memberApi.changeRole(this.workspaceId, member.userId, role), `@${member.nick} is now ${role === 'admin' ? 'an admin' : 'a member'}`)
  }

  async remove(member: WorkspaceMemberDTO): Promise<void> {
    await this.attempt(() => this.memberApi.remove(this.workspaceId, member.userId), `@${member.nick} is out of the workspace`)
  }

  async cancelInvitation(invitation: WorkspaceInvitationDTO): Promise<void> {
    await this.attempt(() => this.invitationApi.cancel(this.workspaceId, invitation.id), `The invitation to ${invitation.email} is cancelled`)
  }

  /** Resolves to whether the signed-in person is out. The last admin cannot leave. */
  async leave(): Promise<boolean> {
    try {
      await this.memberApi.leave(this.workspaceId)
      this.workspaces.forget(this.workspaceId)
      toast.success('You left the workspace')
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    }
  }

  private async attempt(action: () => Promise<void>, done: string): Promise<void> {
    try {
      await action()
      await this.reload()
      toast.success(done)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
