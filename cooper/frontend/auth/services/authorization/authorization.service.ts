import { OauthGrantApi, type OauthGrantReviewDTO } from '@cooper/api/oauth-grant'
import { inject, Store } from 'newt-kit-react'

type AuthorizationState = {
  /** The request the person is on the way to answer, from `?authorization=` or the address. */
  id: string | null
  status: 'none' | 'loading' | 'ready' | 'missing'
  review: OauthGrantReviewDTO | null
}

/**
 * The authorization request the person came with, if any: which product they sign in
 * to, whether it takes new accounts, and whether it lets in whoever is signed in.
 * Signing in, signing up and answering share it.
 */
export class AuthorizationService {

  private readonly api = inject(OauthGrantApi)
  private readonly store = new Store<AuthorizationState>({ id: null, status: 'none', review: null })

  readonly status = this.store.select('status')
  readonly review = this.store.select('review')

  /**
   * Reads the request, unless it is the one already read (`fresh` reads it again). None
   * (null) is signing in to auth itself.
   */
  async load(id: string | null, { fresh = false }: { fresh?: boolean } = {}): Promise<void> {
    if (!fresh && id === this.store.value.id && this.store.value.status !== 'loading') return
    if (id === null) return this.store.patch({ id, status: 'none', review: null })
    this.store.patch({ id, status: 'loading', review: null })
    try {
      const review = await this.api.review(id)
      if (this.store.value.id === id) this.store.patch({ status: 'ready', review })
    } catch {
      if (this.store.value.id === id) this.store.patch({ status: 'missing' })
    }
  }

}
