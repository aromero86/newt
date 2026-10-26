/**
 * Where auth sends the browser back with a code: every web app's OAuth redirect URI
 * is its public URL and this path. auth declares each product's client with it.
 */
export const WEB_SESSION_CALLBACK = '/api/session/callback'

/**
 * The cookies of a context's web session, named after the context: on one host in
 * development (localhost, whatever the port) the cookies of every context meet.
 */
export function webSessionCookies(context: string) {
  return {
    /** The session: the token of a row of the context's own `session` table. */
    session: `cooper_${context}_session`,
    /** A sign-in on its way, until auth sends the browser back: its state, PKCE verifier and where to return. */
    signIn: `cooper_${context}_sign_in`,
  }
}

/** What signing out answers: where the browser goes next, auth's sign-out, which brings it back. */
export type WebSessionSignOutDTO = { next: string }
