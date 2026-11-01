import { HttpRouter } from '@newt-kit/newt/http'
import { CooperBase } from '../../shared/cooper-base'
import { OAUTH_LIMIT } from '../../shared/rate-limits'

/**
 * What `auth`'s modules receive: cooper's base, and a second router at the root for
 * OAuth's addresses (`/oauth/authorize`, `/oauth/token`, `/.well-known/…`). They are
 * not its API's: outside `/api`, public (the client proves itself on its own), and
 * with OAuth's own wire format (a form in, `{ error, error_description }` out, each
 * route's `onError`). The context serves them beside its API (`routes()`). Each
 * address may ask them `OAUTH_LIMIT`.
 */
export class AuthBase extends CooperBase {
  readonly oauth = new HttpRouter({ prefix: '', public: true, rateLimits: this.rateLimitStore, rateLimit: OAUTH_LIMIT })
}
