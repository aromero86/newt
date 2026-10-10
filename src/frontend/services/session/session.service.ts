import { SessionApi } from '@newt/api/session'
import type { UserDTO } from '@newt/api/user'
import { inject } from '../../core/injector/inject'
import { Store } from '../../core/store/store'

type SessionState =
  | { status: 'checking', user: null }
  | { status: 'signed-out', user: null }
  | { status: 'signed-in', user: UserDTO }

/** Who is signed in, if anyone. The one owner of the signed-in user's data. */
export class SessionService {

  private readonly api = inject(SessionApi)
  private readonly store = new Store<SessionState>({ status: 'checking', user: null })

  readonly status = this.store.select('status')
  readonly user = this.store.select('user')

  /** Asks the backend whether this browser has a session. */
  async check(): Promise<void> {
    try {
      this.signedIn(await this.api.me())
    } catch {
      this.expired()
    }
  }

  signedIn(user: UserDTO): void {
    this.store.patch({ status: 'signed-in', user })
  }

  /** The signed-in user changed their profile. */
  replaceUser(user: UserDTO): void {
    if (this.store.value.status === 'signed-in') this.store.patch({ user })
  }

  async signOut(): Promise<void> {
    try {
      await this.api.signOut()
    } finally {
      this.expired()
    }
  }

  /** The backend no longer knows this session. */
  expired(): void {
    this.store.patch({ status: 'signed-out', user: null })
  }
}
