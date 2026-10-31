import { WebSessionApi, signInUrl, type SessionUserDTO } from '@cooper/api/web-session'
import { ApiError, inject, Store } from 'newt-react'

type SessionState =
  | { status: 'checking', user: null }
  | { status: 'signed-out', user: null }
  /** The check itself failed (boards down, no network): whether there is a session is unknown. */
  | { status: 'failed', user: null }
  | { status: 'signed-in', user: SessionUserDTO }

/**
 * Who is signed in, if anyone: the one owner of the signed-in person's data. boards
 * keeps the session (a cookie on its origin); signing in happens at auth, through it.
 */
export class SessionService {

  private readonly api = inject(WebSessionApi)
  private readonly store = new Store<SessionState>({ status: 'checking', user: null })

  /** The check under way, if any. */
  private checking: Promise<void> | null = null

  readonly status = this.store.select('status')
  readonly user = this.store.select('user')

  /**
   * Asks boards whether this browser has a session.
   * A check under way is shared: asking twice (StrictMode's effects) sends one request.
   */
  check(): Promise<void> {
    this.checking ??= this.ask().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async ask(): Promise<void> {
    try {
      const { user } = await this.api.me()
      this.store.patch({ status: 'signed-in', user })
    } catch (error) {
      // Only a 401 says there is no session; any other failure says nothing of it.
      if (error instanceof ApiError && error.status === 401) this.expired()
      else this.store.patch({ status: 'failed', user: null })
    }
  }

  /** Leaves the app for auth's sign in, which comes back to `returnTo`. */
  signIn(returnTo?: string): void {
    location.assign(signInUrl(returnTo && returnTo !== '/' ? returnTo : undefined))
  }

  /**
   * Ends the session here, and the browser goes on to auth to end it there too: signing
   * in again then asks who it is. auth sends it back to `returnTo` (a path of this app)
   * or to the start.
   */
  async signOut(returnTo?: string): Promise<void> {
    let next: string
    try {
      next = (await this.api.signOut(returnTo)).next
    } catch {
      // Not even signed out here: whoever looks is shown the way in again.
      return this.expired()
    }
    location.assign(next)
  }

  /** boards no longer knows this session. */
  expired(): void {
    this.store.patch({ status: 'signed-out', user: null })
  }
}
