import { ApiError, inject, ListStore, Store } from 'newt-kit-react'
import { BackofficeWorkspaceApi, type WorkspaceBoardDTO, type WorkspaceDetailDTO, type WorkspaceMemberDTO } from '@cooper/api/backoffice-workspace'

type WorkspacesDetailState = {
  workspace: WorkspaceDetailDTO | null
  /** No workspace has the id of the address. */
  missing: boolean
  failure: string | null
}

/** One workspace, opened by its address: what it is, who is in it, and its boards. */
export class WorkspacesDetailService {

  private readonly api = inject(BackofficeWorkspaceApi)
  private readonly store = new Store<WorkspacesDetailState>({ workspace: null, missing: false, failure: null })
  private workspaceId = ''

  readonly workspace = this.store.select('workspace')
  readonly missing = this.store.select('missing')
  readonly failure = this.store.select('failure')
  readonly members = new ListStore<WorkspaceMemberDTO>(page => this.api.members(this.workspaceId, page))
  readonly boards = new ListStore<WorkspaceBoardDTO>(page => this.api.boards(this.workspaceId, page))

  async load(workspaceId: string): Promise<void> {
    this.workspaceId = workspaceId
    this.store.reset()
    try {
      this.store.patch({ workspace: await this.api.getWorkspace(workspaceId) })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ missing: true })
      else this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the workspace' })
      return
    }
    await Promise.all([this.members.loadFirstPage(), this.boards.loadFirstPage()])
  }
}
