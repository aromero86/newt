export type Session_Options = {
  /** How long a session lasts without signing in again. */
  days: number
  /** Whether its cookie is Secure: from auth's public URL, since HTTPS ends at the proxy before it. */
  secure: boolean
}
