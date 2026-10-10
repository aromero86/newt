import type { SessionSignInDTO, SessionSignUpDTO } from '../../../backend/modules/session/session.schema'
import type { UserDTO } from '../../../backend/modules/user/user.schema'
import { Requester } from '../core/requester'

/** The backend's `session` module: signing up, in and out, and who is signed in. */
export class SessionApi extends Requester {
  protected readonly path = '/session'

  me() {
    return this.get<UserDTO>('/me')
  }

  signUp(input: SessionSignUpDTO) {
    return this.post<UserDTO>('/sign-up', input)
  }

  signIn(input: SessionSignInDTO) {
    return this.post<UserDTO>('/sign-in', input)
  }

  signOut() {
    return this.post<void>('/sign-out')
  }
}
