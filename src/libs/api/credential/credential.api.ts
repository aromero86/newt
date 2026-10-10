import type { CredentialChangeDTO } from '../../../backend/modules/credential/credential.schema'
import { Requester } from '../core/requester'

/** The backend's `credential` module: passwords. */
export class CredentialApi extends Requester {
  protected readonly path = '/credential'

  /** The signed-in person's own password. */
  change(input: CredentialChangeDTO) {
    return this.post<void>('/password', input)
  }
}
