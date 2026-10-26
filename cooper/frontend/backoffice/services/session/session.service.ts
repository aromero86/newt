import { ApiError } from '@cooper/api/core/api-error'
import { WebSessionApi, signInUrl, type SessionUserDTO } from '@cooper/api/web-session'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'

type SessionState =
  | { status: 'checking', user: null }
  | { status: 'signed-out', user: null }
  /** Signed in, but not of the staff (any more): the backoffice answers them nothing. */
  | { status: 'refused', user: null }
  | { status: 'signed-in', user: SessionUserDTO }

/**
 * Who is signed in to the backoffice, if anyone: the one owner of the signed-in
 * person. The backoffice keeps the session (a cookie on its origin); signing in
 * happens at auth, through it, and only the staff get one.
 */
export class SessionService {

  private readonly api = inject(WebSessionApi)
  private readonly store = new Store<SessionState>({ status: 'checking', user: null })

  readonly status = this.store.select('status')
  readonly user = this.store.select('user')

  /** Asks the backoffice whether this browser has a session, of someone of the staff. */
  async check(): Promise<void> {
    try {
      const { user } = await this.api.me()
      this.store.patch({ status: 'signed-in', user })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) this.store.patch({ status: 'refused', user: null })
      else this.expired()
    }
  }

  /** Leaves for auth's sign in, which comes back to `returnTo`. */
  signIn(returnTo?: string): void {
    location.assign(signInUrl(returnTo && returnTo !== '/' ? returnTo : undefined))
  }

  async signOut(): Promise<void> {
    try {
      await this.api.signOut()
    } finally {
      this.expired()
    }
  }

  /** The backoffice no longer knows this session. */
  expired(): void {
    this.store.patch({ status: 'signed-out', user: null })
  }
}
