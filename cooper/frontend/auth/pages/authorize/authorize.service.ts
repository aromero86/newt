import { OauthGrantApi } from '@cooper/api/oauth-grant'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'
import { AuthorizationService } from '../../services/authorization/authorization.service'
import { SessionService } from '../../services/session/session.service'

type AuthorizeState = {
  /**
   * `signed-out`: the person signs in first. `consent`: an application asks them.
   * `refused`: the product does not let this account in. `leaving`: the browser is on
   * its way back to the application. `closed`: answered already, or expired.
   * `missing`: no such request.
   */
  status: 'loading' | 'signed-out' | 'consent' | 'refused' | 'leaving' | 'closed' | 'missing'
  /** The answer on its way: until the browser leaves, the buttons wait. */
  deciding: 'approve' | 'deny' | null
  failure: string | null
}

/**
 * An application asking the signed-in person for access, and their answer. A
 * product's own client is answered at once: the person was only signing in to it.
 * An account the product does not let in is told so, and may switch accounts.
 */
export class AuthorizeService {

  private readonly api = inject(OauthGrantApi)
  private readonly session = inject(SessionService)
  private readonly authorizations = inject(AuthorizationService)
  private readonly store = new Store<AuthorizeState>({ status: 'loading', deciding: null, failure: null })
  /** The request being answered, and its loading: one per request, however often it is asked for. */
  private loading: { id: string, done: Promise<void> } | null = null

  readonly status = this.store.select('status')
  readonly deciding = this.store.select('deciding')
  readonly failure = this.store.select('failure')

  /**
   * Reads the request, and answers it at once when it is a product's own. Asked again
   * for the same request (StrictMode runs effects twice), it does nothing more: a
   * request is approved once.
   */
  load(id: string): Promise<void> {
    if (this.loading?.id !== id) this.loading = { id, done: this.read(id) }
    return this.loading.done
  }

  approve(): Promise<void> {
    return this.decide('approve')
  }

  deny(): Promise<void> {
    return this.decide('deny')
  }

  /** Signs out of auth, to sign in with another account: the request waits. */
  async switchAccount(): Promise<void> {
    await this.session.signOut()
  }

  private async read(id: string): Promise<void> {
    this.store.patch({ status: 'loading', failure: null })
    // Read again, not reused from signing in: whether the product lets them in depends on who is signed in now.
    await Promise.all([this.session.check(), this.authorizations.load(id, { fresh: true })])
    const review = this.authorizations.review.value
    if (this.session.status.value !== 'signed-in') return this.store.patch({ status: 'signed-out' })
    if (!review) return this.store.patch({ status: 'missing' })
    if (!review.open) return this.store.patch({ status: 'closed' })
    if (review.refused) return this.store.patch({ status: 'refused' })
    if (review.firstParty) return this.decide('approve')
    this.store.patch({ status: 'consent' })
  }

  /** The browser goes back to the application, with a code or a refusal. */
  private async decide(answer: 'approve' | 'deny'): Promise<void> {
    const id = this.loading?.id
    if (!id || this.store.value.deciding) return
    this.store.patch({ deciding: answer, failure: null })
    try {
      const { redirectTo } = await this.api[answer](id)
      this.store.patch({ status: 'leaving' })
      window.location.assign(redirectTo)
    } catch (error) {
      this.store.patch({ deciding: null, failure: error instanceof Error ? error.message : 'Something went wrong' })
      if (this.store.value.status === 'loading') this.store.patch({ status: 'consent' })
    }
  }
}
