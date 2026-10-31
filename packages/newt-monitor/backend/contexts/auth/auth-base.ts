import { HttpRouter } from 'newt/http'
import { MonitorBase } from '../../monitor-base'

/**
 * auth's base: the monitor's, with a router at the root for OAuth's addresses
 * (`/oauth/authorize`, `/oauth/token`, `/.well-known/…`). They are public, and speak
 * OAuth's wire format.
 */
export class AuthBase extends MonitorBase {
  readonly oauth = new HttpRouter({ prefix: '', public: true })
}
