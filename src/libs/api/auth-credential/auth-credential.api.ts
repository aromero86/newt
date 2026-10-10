import type { AuthCredentialChangeDTO } from '../../../backend/modules/auth-credential/auth-credential.schema'
import { Requester } from '../core/requester'

/** The backend's `credential` module: passwords. */
export class AuthCredentialApi extends Requester {
  protected readonly path = '/auth/credential'

  /** The signed-in person's own password. */
  change(input: AuthCredentialChangeDTO) {
    return this.post<void>('/password', input)
  }
}
