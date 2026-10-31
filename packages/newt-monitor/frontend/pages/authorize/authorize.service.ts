import { inject, Store } from 'newt-react'
import { AuthorizationsApi, type OauthGrantReviewDTO } from '../../api/authorizations'

type AuthorizeState = {
  /** What is asked; null while it loads. */
  review: OauthGrantReviewDTO | null
  /** The answer on its way: the browser leaves once it is given. */
  answering: 'approve' | 'deny' | null
  failure: string | null
}

/** An application's request for access to the monitor's MCP server, and the person's answer to it. */
export class AuthorizeService {

  private readonly api = inject(AuthorizationsApi)
  private readonly store = new Store<AuthorizeState>({ review: null, answering: null, failure: null })

  readonly review = this.store.select('review')
  readonly answering = this.store.select('answering')
  readonly failure = this.store.select('failure')

  async open(id: string): Promise<void> {
    this.store.patch({ review: null, answering: null, failure: null })
    try {
      this.store.patch({ review: await this.api.review(id) })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the request' })
    }
  }

  /** Yes or no: either way the browser goes back to the application, which reads the answer. */
  async answer(answer: 'approve' | 'deny'): Promise<void> {
    const id = this.store.value.review?.id
    if (!id) return
    this.store.patch({ answering: answer, failure: null })
    try {
      const { redirectTo } = await this.api[answer](id)
      window.location.assign(redirectTo)
    } catch (error) {
      this.store.patch({ answering: null, failure: error instanceof Error ? error.message : 'Could not answer the request' })
    }
  }
}
