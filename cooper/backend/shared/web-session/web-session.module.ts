import { currentActor, Module, SecretToken, UseCase, type Actor } from 'newt/core'
import type { CooperBase } from '../cooper-base'
import { SignInDenied } from './errors/sign-in-denied'
import { SignInExpired } from './errors/sign-in-expired'
import { SignInFailed } from './errors/sign-in-failed'
import { WebSession } from './web-session'
import type { WebSession_Options } from './web-session-options'
import { WebSession_Repository } from './web-session.repository'
import { registerWebSessionRoutes } from './web-session.routes'
import { WEB_SESSION_CALLBACK } from './web-session.schema'

/** A sign-in on its way, as its cookie keeps it until auth sends the browser back. */
type PendingSignIn = { state: string, verifier: string, returnTo: string }

/**
 * Only a path of the context itself: never another host (`//evil.example`). A browser
 * drops tabs and newlines and reads `\\` as `/`, so a path with any of them is refused,
 * and what is left is resolved as the browser would and kept only on the same origin.
 */
export const ownPath = (path: string | undefined): string => {
  if (!path || !path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path)) return '/'
  const url = new URL(path, 'http://x.invalid')
  return url.origin === 'http://x.invalid' ? url.pathname + url.search + url.hash : '/'
}

/**
 * The web session of a context that signs its people in through auth: boards and
 * backoffice. The context is an OAuth confidential client of auth, and its server
 * does the OAuth (a backend for its frontend): the browser only ever holds the
 * context's own session cookie, never a token.
 *
 * - `GET /api/session/sign-in?returnTo=/path` starts it: a state and a PKCE verifier
 *   in a short cookie, and the browser to auth's `/oauth/authorize`.
 * - `GET /api/session/callback` is where auth sends the browser back with a code: the
 *   server trades it at auth's `/oauth/token` (over HTTP, with its secret), asks auth
 *   who the access token is for, gives the tokens back (`/oauth/revoke`: the context
 *   keeps none), and opens its own session.
 * - `GET /api/session` is the signed-in person; `POST /api/session/sign-out?returnTo=/path`
 *   ends it, and answers where the browser goes next: auth, to end its session too.
 * - Every other route of the context runs as that person: it sets the router's
 *   authenticator.
 *
 * A context's sessions are its own, in its own store: it initializes this module in
 * its `initialize-modules.ts` and copies `migrations/sqlite/00001_session_up.sql` (and its
 * down) into its own migrations, numbered after the ones it has:
 *
 * ```ts
 * const session = WebSession_Module.initialize(base, {
 *   context: 'boards',
 *   clientId: 'cooper',
 *   clientSecret: config.clientSecret,
 *   publicUrl: config.publicUrl,
 *   authUrl: config.authPublicUrl,
 *   days: config.sessionDays,
 *   identify: accessToken => deps.auth.token.verify(accessToken),
 *   profile: userId => deps.auth.user.get(userId),
 * })
 * ```
 */
export class WebSession_Module extends Module {

  static initialize(base: CooperBase, options: WebSession_Options): WebSession_Module {
    const module = new WebSession_Module(base, new WebSession_Repository(base), options)
    registerWebSessionRoutes(base, module, options)
    return module
  }

  private constructor(base: CooperBase, private readonly repo: WebSession_Repository, private readonly options: WebSession_Options) {
    super('session', base.invocations)
  }

  /** A new sign-in: where to send the browser, and what its cookie keeps until it comes back. */
  @UseCase()
  async begin(returnTo: string | undefined): Promise<{ location: string, pending: string }> {
    const pending: PendingSignIn = { state: SecretToken.generate(), verifier: SecretToken.generate(), returnTo: ownPath(returnTo) }
    const challenge = new Bun.CryptoHasher('sha256').update(pending.verifier).digest('base64url')
    const location = new URL('/oauth/authorize', this.options.authUrl)
    location.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.options.clientId,
      redirect_uri: this.redirectUri(),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: pending.state,
    }).toString()
    return { location: location.toString(), pending: Buffer.from(JSON.stringify(pending)).toString('base64url') }
  }

  /**
   * auth sent the browser back: the code is traded for who signed in, and the
   * context's own session is opened. It calls auth over HTTP before saving, so it
   * never runs again on a conflict: the code is spent.
   */
  @UseCase({ retryOnConflict: false })
  async complete(input: { code?: string, state?: string, error?: string, errorDescription?: string, pending?: string }): Promise<{ token: SecretToken, returnTo: string }> {
    const pending = this.readPending(input.pending)
    if (!pending || input.state !== pending.state) throw new SignInExpired()
    if (input.error) throw new SignInDenied(input.errorDescription ?? input.error)
    if (!input.code) throw new SignInExpired()

    const tokens = await this.post('/oauth/token', { grant_type: 'authorization_code', code: input.code, redirect_uri: this.redirectUri(), code_verifier: pending.verifier })
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : ''
    const identity = await this.options.identify(accessToken)
    if (!identity || identity.productId !== this.options.clientId) throw new SignInFailed('auth did not say who signed in')
    // The context keeps no token: who signed in is all it needed. Giving them back ends them.
    if (typeof tokens.refresh_token === 'string') await this.post('/oauth/revoke', { token: tokens.refresh_token })

    const { session, token } = WebSession.open(identity.userId, this.options.days)
    await this.repo.persist(session)
    return { token, returnTo: pending.returnTo }
  }

  /** Who sent a request, from the session cookie's token. An expired session is closed. */
  @UseCase()
  async authenticate(token: string | undefined): Promise<Actor | null> {
    const session = await this.find(token)
    if (!session) return null
    if (session.isExpired()) {
      session.close()
      await this.repo.persist(session)
      return null
    }
    return { userId: session.userId, via: 'web' }
  }

  /** The signed-in person, as the context's options describe them. */
  @UseCase()
  async me(): Promise<unknown> {
    return this.options.profile(currentActor().userId)
  }

  /** Ends the session of this token, if it is one: signing out twice is signing out once. */
  @UseCase()
  async signOut(token: string | undefined): Promise<void> {
    const session = await this.find(token)
    if (!session) return
    session.close()
    await this.repo.persist(session)
  }

  private redirectUri(): string {
    return `${this.options.publicUrl}${WEB_SESSION_CALLBACK}`
  }

  private readPending(value: string | undefined): PendingSignIn | null {
    try {
      const pending = JSON.parse(Buffer.from(value ?? '', 'base64url').toString()) as Partial<PendingSignIn>
      return typeof pending.state === 'string' && typeof pending.verifier === 'string' ? { state: pending.state, verifier: pending.verifier, returnTo: ownPath(pending.returnTo) } : null
    } catch {
      return null
    }
  }

  /** A form to one of auth's OAuth endpoints, as this context's client (`client_secret_basic`). */
  private async post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const credentials = Buffer.from(`${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`).toString('base64')
    const response = await fetch(new URL(path, this.options.authUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${credentials}` },
      body: new URLSearchParams(form),
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) throw new SignInFailed(typeof body.error_description === 'string' ? body.error_description : `auth answered ${response.status}`)
    return body
  }

  private async find(token: string | undefined): Promise<WebSession | undefined> {
    const parsed = SecretToken.schema.safeParse(token)
    return parsed.success ? this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
  }
}
