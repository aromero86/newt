import type { OauthGrantRedirectDTO, OauthGrantReviewDTO } from '../../../backend/contexts/auth/modules/oauth-grant/oauth-grant.schema'
import { Requester } from '../core/requester'

/** The authorization requests auth's UI shows and answers. */
export class OauthGrantApi extends Requester {
  protected readonly path = '/authorizations'

  review(id: string) {
    return this.get<OauthGrantReviewDTO>(`/${encodeURIComponent(id)}`)
  }

  approve(id: string) {
    return this.post<OauthGrantRedirectDTO>(`/${encodeURIComponent(id)}/approve`)
  }

  deny(id: string) {
    return this.post<OauthGrantRedirectDTO>(`/${encodeURIComponent(id)}/deny`)
  }
}
