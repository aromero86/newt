import type { SessionSignInDTO, SessionSignUpDTO } from '../../../backend/contexts/auth/modules/session/session.schema'
import type { UserDTO } from '../../../backend/contexts/auth/modules/user/user.schema'
import { Requester } from '@newt-kit/react'

/** auth's own session: signing up, in and out, and who is signed in. */
export class SessionApi extends Requester {
  protected readonly path = '/session'

  me() {
    return this.get<UserDTO>('')
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
