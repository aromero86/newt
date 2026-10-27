import { ApiError, inject, Store } from 'newt-react'
import { WebSessionApi, signInUrl, type SessionUserDTO } from '@cooper/api/web-session'

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

  /** The check under way, if any. */
  private checking: Promise<void> | null = null

  readonly status = this.store.select('status')
  readonly user = this.store.select('user')

  /**
   * Asks the backoffice whether this browser has a session, of someone of the staff.
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
      if (error instanceof ApiError && error.status === 403) this.store.patch({ status: 'refused', user: null })
      else this.expired()
    }
  }

  /** Leaves for auth's sign in, which comes back to `returnTo`. */
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

  /** The backoffice no longer knows this session. */
  expired(): void {
    this.store.patch({ status: 'signed-out', user: null })
  }
}
