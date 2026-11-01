import { Store, inject } from 'newt-kit-react'
import { SessionApi, type MeDTO } from '../../api/session'

type SessionState =
  | { status: 'checking', user: null }
  | { status: 'signed-out', user: null }
  | { status: 'signed-in', user: MeDTO }

/**
 * Who is signed in to the monitor, if anyone. The session is a cookie the page cannot
 * read: the monitor says whether there is one.
 */
export class SessionService {

  private readonly api = inject(SessionApi)
  private readonly store = new Store<SessionState>({ status: 'checking', user: null })

  /** The check under way, if any. */
  private checking: Promise<void> | null = null

  readonly status = this.store.select('status')
  readonly user = this.store.select('user')

  /** Asks the monitor whether this browser has a session. A check under way is shared. */
  check(): Promise<void> {
    this.checking ??= this.api.me()
      .then(user => this.signedIn(user), () => this.expired())
      .finally(() => {
        this.checking = null
      })
    return this.checking
  }

  signedIn(user: MeDTO): void {
    this.store.patch({ status: 'signed-in', user })
  }

  /** Ends the session; whatever the monitor answers, this browser shows the way in again. */
  async signOut(): Promise<void> {
    await this.api.signOut().catch(() => undefined)
    this.expired()
  }

  /** The monitor no longer knows this session. */
  expired(): void {
    this.store.patch({ status: 'signed-out', user: null })
  }
}
