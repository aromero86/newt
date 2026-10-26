import { OauthGrantApi, type OauthGrantReviewDTO } from '@cooper/api/oauth-grant'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'

type AuthorizationState = {
  /** The request the person is on the way to answer, from `?authorization=` or the address. */
  id: string | null
  status: 'none' | 'loading' | 'ready' | 'missing'
  review: OauthGrantReviewDTO | null
}

/**
 * The authorization request the person came with, if any: which product they sign in
 * to, and whether it takes new accounts. Signing in, signing up and answering share it.
 */
export class AuthorizationService {

  private readonly api = inject(OauthGrantApi)
  private readonly store = new Store<AuthorizationState>({ id: null, status: 'none', review: null })

  readonly status = this.store.select('status')
  readonly review = this.store.select('review')

  /** Reads the request, unless it is the one already read. None (null) is signing in to auth itself. */
  async load(id: string | null): Promise<void> {
    if (id === this.store.value.id && this.store.value.status !== 'loading') return
    if (id === null) return this.store.patch({ id, status: 'none', review: null })
    this.store.patch({ id, status: 'loading', review: null })
    try {
      const review = await this.api.review(id)
      if (this.store.value.id === id) this.store.patch({ status: 'ready', review })
    } catch {
      if (this.store.value.id === id) this.store.patch({ status: 'missing' })
    }
  }

  /** Read again: after an answer, it is no longer open. */
  async reload(): Promise<void> {
    const { id } = this.store.value
    this.store.patch({ id: null })
    await this.load(id)
  }
}
