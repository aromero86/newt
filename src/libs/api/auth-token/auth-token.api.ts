import type { AuthTokenCreateDTO, AuthTokenCreatedDTO, AuthTokenDTO } from '../../../backend/modules/auth-token/auth-token.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `auth-token` module: the signed-in person's access tokens, for AI assistants. */
export class AuthTokenApi extends Requester {
  protected readonly path = '/auth/tokens'

  /** A page of them, newest first. */
  list(page?: PageRequest) {
    return this.get<Page<AuthTokenDTO>>('', page)
  }

  /** The secret comes only in this answer. */
  create(input: AuthTokenCreateDTO) {
    return this.post<AuthTokenCreatedDTO>('', input)
  }

  revoke(tokenId: string) {
    return this.delete<void>(`/${tokenId}`)
  }
}
