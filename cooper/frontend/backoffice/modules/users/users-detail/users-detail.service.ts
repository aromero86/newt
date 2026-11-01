import { ApiError, inject, ListStore, Store } from '@newt-kit/react'
import { BackofficeUserApi, type UserDetailDTO, type UserWorkspaceDTO } from '@cooper/api/backoffice-user'

type UsersDetailState = {
  user: UserDetailDTO | null
  /** No account has the id of the address. */
  missing: boolean
  failure: string | null
}

/** One account, opened by its address, and the workspaces it belongs to. */
export class UsersDetailService {

  private readonly api = inject(BackofficeUserApi)
  private readonly store = new Store<UsersDetailState>({ user: null, missing: false, failure: null })
  private userId = ''

  readonly user = this.store.select('user')
  readonly missing = this.store.select('missing')
  readonly failure = this.store.select('failure')
  readonly workspaces = new ListStore<UserWorkspaceDTO>(page => this.api.workspaces(this.userId, page))

  async load(userId: string): Promise<void> {
    this.userId = userId
    this.store.reset()
    try {
      this.store.patch({ user: await this.api.getUser(userId) })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ missing: true })
      else this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the account' })
      return
    }
    await this.workspaces.loadFirstPage()
  }
}
