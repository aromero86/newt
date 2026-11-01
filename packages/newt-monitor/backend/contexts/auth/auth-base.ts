import { HttpRouter } from 'newt/http'
import { MonitorBase } from '../../monitor-base'
import { OAUTH_LIMIT } from '../../shared/rate-limits'

/**
 * auth's base: the monitor's, with a router at the root for OAuth's addresses
 * (`/oauth/authorize`, `/oauth/token`, `/.well-known/…`). They are public, speak
 * OAuth's wire format, and each address may ask them `OAUTH_LIMIT`.
 */
export class AuthBase extends MonitorBase {
  readonly oauth = new HttpRouter({ prefix: '', public: true, rateLimits: this.rateLimitStore, clock: this.clock, rateLimit: OAUTH_LIMIT })
}
