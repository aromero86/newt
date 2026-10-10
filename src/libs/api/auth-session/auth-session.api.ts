import type { AuthSessionSignInDTO, AuthSessionSignUpDTO } from '../../../backend/modules/auth-session/auth-session.schema'
import type { UserDTO } from '../../../backend/modules/user/user.schema'
import { Requester } from '../core/requester'

/** The backend's `session` module: signing up, in and out, and who is signed in. */
export class AuthSessionApi extends Requester {
  protected readonly path = '/auth/session'

  me() {
    return this.get<UserDTO>('/me')
  }

  signUp(input: AuthSessionSignUpDTO) {
    return this.post<UserDTO>('/sign-up', input)
  }

  signIn(input: AuthSessionSignInDTO) {
    return this.post<UserDTO>('/sign-in', input)
  }

  signOut() {
    return this.post<void>('/sign-out')
  }
}
