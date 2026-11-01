import { computed } from '@preact/signals-core'
import { WorkspaceMemberApi, type WorkspaceMemberDTO } from '@cooper/api/workspace-member'
import { inject, Store } from '@newt-kit/react'
import { toast } from '@newt-kit/react-ui/toast'
import { SessionService } from '../../services/session/session.service'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

type WorkspaceState = {
  workspaceId: string
  members: WorkspaceMemberDTO[]
  loaded: boolean
  failure: string | null
}

/**
 * The people of the workspace being shown: the one owner of its members, whom the
 * boards show as assignees, the search filters by, and the settings list. A
 * workspace's members are a short list, so they come whole.
 */
export class WorkspaceService {

  private readonly api = inject(WorkspaceMemberApi)
  private readonly session = inject(SessionService)
  private readonly workspaces = inject(WorkspacesService)
  private readonly store = new Store<WorkspaceState>({ workspaceId: '', members: [], loaded: false, failure: null })

  readonly members = this.store.select('members')
  readonly loaded = this.store.select('loaded')
  readonly failure = this.store.select('failure')
  /** Each member by their user's id, to name a card's assignee. */
  readonly byId = computed(() => new Map(this.members.value.map(member => [member.id, member])))

  get workspaceId(): string {
    return this.store.value.workspaceId
  }

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId, members: [], loaded: false, failure: null })
    try {
      const members = await this.api.list(workspaceId)
      // Another workspace may have been opened meanwhile.
      if (this.workspaceId === workspaceId) this.store.patch({ members, loaded: true })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the members' })
    }
  }

  /** Takes someone out of the workspace: admins only, and never the admin. */
  async remove(member: WorkspaceMemberDTO): Promise<void> {
    try {
      await this.api.remove(this.workspaceId, member.id)
      this.store.update(state => ({ members: state.members.filter(each => each.id !== member.id) }))
      toast.success(`${member.name} is out of the workspace`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  /**
   * The signed-in member leaves the workspace (its admin cannot). Resolves to whether
   * they are out; then `forgetLeft` takes it off their workspaces, once the page left it.
   */
  async leave(): Promise<boolean> {
    const me = this.session.user.value
    if (!me) return false
    try {
      await this.api.leave(this.workspaceId, me.id)
      toast.success('You left the workspace')
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    }
  }

  /** The workspace just left is no longer among the person's. */
  forgetLeft(): void {
    this.workspaces.forget(this.workspaceId)
  }
}
