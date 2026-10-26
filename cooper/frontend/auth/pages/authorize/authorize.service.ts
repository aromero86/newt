import { OauthGrantApi } from '@cooper/api/oauth-grant'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'
import { AuthorizationService } from '../../services/authorization/authorization.service'
import { SessionService } from '../../services/session/session.service'

type AuthorizeState = {
  /**
   * `signed-out`: the person signs in first. `consent`: an application asks them.
   * `leaving`: the browser is on its way back to the application. `closed`: answered
   * already, or expired. `missing`: no such request.
   */
  status: 'loading' | 'signed-out' | 'consent' | 'leaving' | 'closed' | 'missing'
  /** The answer on its way: until the browser leaves, the buttons wait. */
  deciding: 'approve' | 'deny' | null
  failure: string | null
}

/**
 * An application asking the signed-in person for access, and their answer. A
 * product's own client is answered at once: the person was only signing in to it.
 */
export class AuthorizeService {

  private readonly api = inject(OauthGrantApi)
  private readonly session = inject(SessionService)
  private readonly authorizations = inject(AuthorizationService)
  private readonly store = new Store<AuthorizeState>({ status: 'loading', deciding: null, failure: null })
  private id: string | null = null

  readonly status = this.store.select('status')
  readonly deciding = this.store.select('deciding')
  readonly failure = this.store.select('failure')

  async load(id: string): Promise<void> {
    this.id = id
    this.store.patch({ status: 'loading', failure: null })
    await Promise.all([this.session.check(), this.authorizations.load(id)])
    const review = this.authorizations.review.value
    if (this.session.status.value !== 'signed-in') return this.store.patch({ status: 'signed-out' })
    if (!review) return this.store.patch({ status: 'missing' })
    if (!review.open) return this.store.patch({ status: 'closed' })
    if (review.firstParty) return this.decide('approve')
    this.store.patch({ status: 'consent' })
  }

  approve(): Promise<void> {
    return this.decide('approve')
  }

  deny(): Promise<void> {
    return this.decide('deny')
  }

  /** The browser goes back to the application, with a code or a refusal. */
  private async decide(answer: 'approve' | 'deny'): Promise<void> {
    if (!this.id) return
    this.store.patch({ deciding: answer, failure: null })
    try {
      const { redirectTo } = await this.api[answer](this.id)
      this.store.patch({ status: 'leaving' })
      window.location.assign(redirectTo)
    } catch (error) {
      this.store.patch({ status: 'consent', deciding: null, failure: error instanceof Error ? error.message : 'Something went wrong' })
    }
  }
}
