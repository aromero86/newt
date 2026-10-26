import type { UserDetailDTO, UserDTO, UserWorkspaceDTO } from '../../../backend/contexts/backoffice/modules/user/user.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backoffice's `user` module: every account of cooper, as the staff see them. */
export class BackofficeUserApi extends Requester {
  protected readonly path = '/users'

  /** The newest first; with a text, the accounts whose email or name it is. */
  list(text: string | undefined, page?: PageRequest) {
    return this.get<Page<UserDTO>>('', { text, ...page })
  }

  getUser(userId: string) {
    return this.get<UserDetailDTO>(`/${userId}`)
  }

  /** The workspaces they belong to, the ones they joined last first. */
  workspaces(userId: string, page?: PageRequest) {
    return this.get<Page<UserWorkspaceDTO>>(`/${userId}/workspaces`, page)
  }
}
