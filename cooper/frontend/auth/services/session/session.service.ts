import { SessionApi } from '@cooper/api/session'
import type { UserDTO } from '@cooper/api/user'
import { inject, Store } from 'newt-react'

type SessionState =
  | { status: 'checking', user: null }
  | { status: 'signed-out', user: null }
  | { status: 'signed-in', user: UserDTO }

/** Who is signed in to auth, if anyone: the one owner of the signed-in account. */
export class SessionService {

  private readonly api = inject(SessionApi)
  private readonly store = new Store<SessionState>({ status: 'checking', user: null })
  /** The first check, which every later one waits for. */
  private checking: Promise<void> | null = null

  readonly status = this.store.select('status')
  readonly user = this.store.select('user')

  /** Asks auth whether this browser has a session, once: later calls wait for the same answer. */
  check(): Promise<void> {
    this.checking ??= this.api.me().then(user => this.signedIn(user), () => this.signedOut())
    return this.checking
  }

  signedIn(user: UserDTO): void {
    this.store.patch({ status: 'signed-in', user })
  }

  async signOut(): Promise<void> {
    try {
      await this.api.signOut()
    } finally {
      this.signedOut()
    }
  }

  private signedOut(): void {
    this.store.patch({ status: 'signed-out', user: null })
  }
}
