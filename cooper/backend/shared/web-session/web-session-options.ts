/** Who an access token from auth acts for: what auth's `token.verify` answers. */
export type WebSessionIdentity = { userId: string, productId: string }

export type WebSession_Options = {
  /** The context's name: its cookies are named after it (`cooper_<context>_session`). */
  context: string
  /** Its OAuth client in auth: the product it is (`cooper`, `backoffice`). */
  clientId: string
  /** Its OAuth client's secret, which only its server knows. */
  clientSecret: string
  /** Where people open the context: its redirect URI is this and `WEB_SESSION_CALLBACK`. */
  publicUrl: string
  /** Where auth is: the browser goes to its `/oauth/authorize`, the server to its `/oauth/token`. */
  authUrl: string
  /** How long a session lasts without signing in again. */
  days: number
  /** Who an access token acts for: auth's `token.verify`, called in the same process. */
  identify: (accessToken: string) => Promise<WebSessionIdentity | null>
  /** What `GET /api/session` answers for the signed-in person: auth's `user.get`, usually. */
  profile: (userId: string) => Promise<unknown>
}
