import { SessionApi, signInUrl, type SessionUserDTO } from '@cooper/api/session'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'

type SessionState =
  | { status: 'checking', user: null }
  | { status: 'signed-out', user: null }
  | { status: 'signed-in', user: SessionUserDTO }

/**
 * Who is signed in, if anyone: the one owner of the signed-in person's data. boards
 * keeps the session (a cookie on its origin); signing in happens at auth, through it.
 */
export class SessionService {

  private readonly api = inject(SessionApi)
  private readonly store = new Store<SessionState>({ status: 'checking', user: null })

  readonly status = this.store.select('status')
  readonly user = this.store.select('user')

  /** Asks boards whether this browser has a session. */
  async check(): Promise<void> {
    try {
      const { user } = await this.api.me()
      this.store.patch({ status: 'signed-in', user })
    } catch {
      this.expired()
    }
  }

  /** Leaves the app for auth's sign in, which comes back to `returnTo`. */
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

  /** boards no longer knows this session. */
  expired(): void {
    this.store.patch({ status: 'signed-out', user: null })
  }
}
