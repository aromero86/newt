import type { OauthGrantRedirectDTO, OauthGrantReviewDTO } from '../../../backend/contexts/auth/modules/oauth-grant/oauth-grant.schema'
import { Requester } from '@newt-kit/react'

/** auth's `oauthGrant` module: an application's request for access to the monitor's MCP server, and the person's answer. */
export class AuthorizationsApi extends Requester {
  protected readonly path = '/authorizations'

  /** Who asks, and whether it still waits for an answer. */
  review(id: string) {
    return this.get<OauthGrantReviewDTO>(`/${id}`)
  }

  /** Yes: where the browser goes back to, with a code for the application. */
  approve(id: string) {
    return this.post<OauthGrantRedirectDTO>(`/${id}/approve`)
  }

  /** No: where the browser goes back to, empty-handed. */
  deny(id: string) {
    return this.post<OauthGrantRedirectDTO>(`/${id}/deny`)
  }
}
