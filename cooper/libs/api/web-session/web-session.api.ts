import { Requester } from '../core/requester'
import type { SessionDTO } from './web-session.contract'

/**
 * Where the browser goes to sign in: a navigation, not a request. boards sends it to
 * auth and, once back, to `returnTo` (a path of this app).
 */
export function signInUrl(returnTo?: string): string {
  return returnTo ? `/api/session/sign-in?returnTo=${encodeURIComponent(returnTo)}` : '/api/session/sign-in'
}

/** A context's web session (cooper/backend/shared/web-session): who is signed in, and signing out. */
export class WebSessionApi extends Requester {
  protected readonly path = '/session'

  /** The signed-in person: a 401 without a session. */
  me() {
    return this.get<SessionDTO>('')
  }

  signOut() {
    return this.post<void>('/sign-out')
  }
}
