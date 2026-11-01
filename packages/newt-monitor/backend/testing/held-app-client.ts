import type { ApplicationDescription } from 'newt-kit/runtime'
import type { Endpoint } from '../shared/app-client/app-client'
import { HttpAppClient } from '../shared/app-client/http-app-client'

/**
 * The applications over HTTP, as the monitor reaches them, but for a test that makes
 * something happen while one is asked its structure: once, before it answers.
 */
export class HeldAppClient extends HttpAppClient {
  /** What happens, the next time an application is asked its structure, before it answers. */
  meanwhile: (() => Promise<void>) | null = null

  override async structure(endpoint: Endpoint): Promise<ApplicationDescription> {
    const answer = await super.structure(endpoint)
    const meanwhile = this.meanwhile
    this.meanwhile = null
    await meanwhile?.()
    return answer
  }
}
