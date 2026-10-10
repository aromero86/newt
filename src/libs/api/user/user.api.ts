import type { UserDTO, UserUpdateDTO } from '../../../backend/modules/user/user.schema'
import { Requester } from '../core/requester'

/** The backend's `user` module: profiles. */
export class UserApi extends Requester {
  protected readonly path = '/users'

  /** The signed-in person's own profile. */
  updateMine(changes: UserUpdateDTO) {
    return this.patch<UserDTO>('/me', changes)
  }
}
