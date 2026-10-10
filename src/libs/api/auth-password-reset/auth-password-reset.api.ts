import type { AuthPasswordResetCompleteDTO, AuthPasswordResetRequestDTO } from '../../../backend/modules/auth-password-reset/auth-password-reset.schema'
import { Requester } from '../core/requester'

/** The backend's `password-reset` module: getting back in through an email link. */
export class AuthPasswordResetApi extends Requester {
  protected readonly path = '/auth/password-reset'

  request(input: AuthPasswordResetRequestDTO) {
    return this.post<void>('', input)
  }

  complete(input: AuthPasswordResetCompleteDTO) {
    return this.post<void>('/complete', input)
  }
}
