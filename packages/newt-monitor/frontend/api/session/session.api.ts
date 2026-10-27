import type { MeDTO, SignInDTO } from '../../../src/contexts/monitor/modules/session/session.schema'
import { Requester } from 'newt-react'

/** The monitor's `session` module: who is signed in, in a cookie the page cannot read. */
export class SessionApi extends Requester {
  protected readonly path = '/session'

  /** A 401 `session.wrong_credentials` for a wrong user or password. */
  signIn(input: SignInDTO) {
    return this.post<MeDTO>('', input)
  }

  me() {
    return this.get<MeDTO>('')
  }

  signOut() {
    return this.delete<void>('')
  }
}
