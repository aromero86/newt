import { HttpRouter } from 'newt/http'
import { CooperBase } from '../../shared/cooper-base'

/**
 * What `auth`'s modules receive: cooper's base, and a second router for the OAuth
 * endpoints (`/oauth/authorize`, `/oauth/token`…). They are OAuth's addresses, not its
 * API's: outside `/api`, and with OAuth's own wire format (a form in, `{ error,
 * error_description }` out). The context serves them beside its API (`routes()`).
 */
export class AuthBase extends CooperBase {
  readonly oauth = new HttpRouter({ prefix: '/oauth' })
}
