# Signing in to boards: the web session

Since [chapter 2](./02-first-module), boards believes whoever sends a request: an
`x-user` header says who they are, and anyone can write anyone's id in it. Chapter
[17](./17-auth) gave auth accounts and sessions of its own, and chapter
[21](./21-oauth-server) made it an OAuth server. auth already knows boards: it declares
the product `cooper` as an OAuth **confidential client**, with a secret and a redirect
URI, boards' public URL followed by `/api/session/callback`. Nothing answers at that
address yet.

This chapter makes boards that client, and the `x-user` header goes for good.

boards' **server** does the OAuth, not the page in the browser. This is often called a
backend for the frontend. The browser only ever holds boards' own session cookie,
never a token of auth's. A script injected into one of boards' pages has nothing to
steal, and the client secret never leaves the server. A sign-in goes like this:

1. The browser opens `GET /api/session/sign-in?returnTo=/` on boards. boards makes a
   random `state` and a PKCE verifier, keeps them in a short cookie, and sends the
   browser to auth's `/oauth/authorize`.
2. At auth, the person signs in or up, and says yes. auth's pages come in [chapter
   23](./23-frontends); in this chapter you drive them through auth's API.
3. auth sends the browser back to boards' `/api/session/callback` with a `code` and the
   `state`.
4. boards' server checks the `state` against its cookie, trades the code at auth's
   `/oauth/token` with its secret and the verifier, and asks auth who the access token
   is for. It gives the tokens back, opens a session of its own and sets its cookie.
5. Every other request to boards runs as whoever that cookie says.

The backoffice (chapter [25](./25-backoffice)) signs its staff in the same way. So the
code is not boards': it is a module in `shared/web-session/`, which each context
initializes with its own options and whose table lives in that context's own store.

Chapter 21 already made one file of that folder, `web-session.schema.ts`, with
`WEB_SESSION_CALLBACK`: auth needed the callback's path to declare each product's
redirect URI. This chapter adds the rest.

## Its settings

boards needs three settings more: where auth is, the secret of its client, and how
long a session lasts. `publicUrls`, `clientSecrets` and `sessionDays` are already in
`config.ts` (auth uses them). Add the last three lines of `boards`:

```ts
// cooper/backend/config.ts
// …
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
    publicUrl: publicUrls.boards,
    /** Where its people sign in. */
    authPublicUrl: publicUrls.auth,
    /** Its OAuth client's secret: boards is the product `cooper` in auth. */
    clientSecret: clientSecrets.cooper,
    sessionDays,
  },
}
```

`authPublicUrl` is auth's **public** URL, where people open it, not its port: the
browser goes there, and so does boards' server when it calls `/oauth/token`. In
development the public URLs are the Vite servers of chapter 23 (`localhost:5171` for
auth, `localhost:5172` for boards). Until then, the by-hand check at the end of the
chapter points them at the backend's ports.

## The cookies

A context's web session has two cookies. Replace `web-session.schema.ts`:

```ts
// cooper/backend/shared/web-session/web-session.schema.ts
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
```

- **The names carry the context's name**, as auth's `cooper_auth_session` did in
  [chapter 17](./17-auth). Browsers keep cookies by host name, not by port: in
  development every context is on `localhost`, so they all see each other's cookies.
  `cooper_boards_session` and `cooper_auth_session` must not be one cookie.
- **`signIn`** lives only while the person is at auth: it keeps the `state`, the PKCE
  verifier and where to go back. Its content is not secret from the person, but the
  `state` in it is what proves the callback answers a sign-in this browser started.
- **`WebSessionSignOutDTO`** is what signing out answers: the address of auth's
  sign-out, where the browser goes next. It is a type the frontend reads (chapter 23).

## The session

A web session is auth's `Session` of chapter 17 again, in another context: the browser
holds a `SecretToken`, the store only its hash.

```ts
// cooper/backend/shared/web-session/web-session.ts
import { z } from 'zod'
import { Entity, now, SecretToken, type EntityInput } from 'newt/core'

const WebSessionSchema = z.object({
  id: z.uuidv7(),
  /** auth's user, as the token traded at sign-in said. */
  userId: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type WebSessionDTO = z.infer<typeof WebSessionSchema>

/**
 * A browser signed in to one context of cooper: the context's own, on its own origin,
 * opened once auth said who the person is. The browser holds the token; the store
 * only its hash.
 */
export class WebSession extends Entity<typeof WebSessionSchema> {

  private constructor(input: EntityInput<WebSessionDTO>, isNew: boolean) {
    super(WebSessionSchema, input, isNew)
  }

  static fromDTO(dto: WebSessionDTO & { version: number }): WebSession {
    return new WebSession(dto, false)
  }

  static open(userId: string, days: number): { session: WebSession, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(now().getTime() + days * 24 * 60 * 60_000).toISOString()
    return { session: new WebSession({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }

  get userId(): string {
    return this.data.userId
  }

  isExpired(at = now()): boolean {
    return new Date(this.data.expiresAt) <= at
  }

  /** Signed out, or expired: its row goes. */
  close(): void {
    this.markAsDeleted()
  }
}
```

One thing differs from chapter 17: it reads the time with **`now()`**, not with
`Date.now()`. `WebSession.open` and `isExpired` run inside the module's use cases, so
they go by the clock of the context running them, boards' or the backoffice's. A test
that gives boards a clock moves when its sessions expire too. boards has no clock yet:
it gets one below.

Its repository is a plain `TableRepository` over a table named `session`:

```ts
// cooper/backend/shared/web-session/web-session.repository.ts
import { TableRepository } from 'newt/repository'
import type { CooperBase } from '../cooper-base'
import { WebSession, type WebSessionDTO } from './web-session'

export type WebSessionRow = WebSessionDTO & { version: number }

/** The context's `session` table: each context has its own, made by the migration it copies. */
export class WebSession_Repository extends TableRepository<WebSession, WebSessionRow, CooperBase> {

  constructor(base: CooperBase) {
    super(base, base.store.table<WebSessionRow>('session'))
  }

  protected toEntity(row: WebSessionRow): WebSession {
    return WebSession.fromDTO(row)
  }
}
```

The repository takes a `CooperBase`, any context's base. Which `session` table it
writes depends on the base it is given: boards' base writes boards' database.

## Its table, in each context's store

The module brings its migration in its own folder, `migrations/sqlite/`:

```sql
-- cooper/backend/shared/web-session/migrations/sqlite/00001_session_up.sql
-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user_id ON session (user_id);
```

```sql
-- cooper/backend/shared/web-session/migrations/sqlite/00001_session_down.sql
DROP TABLE session;
```

It is the same table as auth's `session`, and that is no clash: each context has its
own database. But a store runs the migrations of **one** folder, its context's
(chapter [5](./05-sqlite)). So each context that initializes the module copies these
two files into its own migrations, numbered after the ones it has. boards has five, so
its copy is `00006_session`:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00006_session_up.sql
-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user_id ON session (user_id);
```

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00006_session_down.sql
DROP TABLE session;
```

The copy in `shared/web-session/` is the source each context copies, and the one the
module's own test opens its store with (below). Once boards' copy has run, it is
boards' migration like any other: never edited.

## Its errors

Three ways a sign-in can fail, each with its own code:

```ts
// cooper/backend/shared/web-session/errors/sign-in-expired.ts
import { ValidationError } from 'newt/core'

/** The browser came back without the sign-in it started here, or with another one's state. */
export class SignInExpired extends ValidationError {
  readonly code = 'session.sign_in_expired'
  constructor() {
    super('The sign-in took too long or was started elsewhere: sign in again')
  }
}
```

```ts
// cooper/backend/shared/web-session/errors/sign-in-denied.ts
import { ForbiddenError } from 'newt/core'

/** auth sent the browser back with no code: the person said no, or may not enter. */
export class SignInDenied extends ForbiddenError {
  readonly code = 'session.sign_in_denied'
  constructor(reason: string) {
    super(`The sign-in did not finish: ${reason}`)
  }
}
```

```ts
// cooper/backend/shared/web-session/errors/sign-in-failed.ts
import { UnauthorizedError } from 'newt/core'

/** auth would not trade the code, or its token said nothing of this app. */
export class SignInFailed extends UnauthorizedError {
  readonly code = 'session.sign_in_failed'
  constructor(reason: string) {
    super(`The sign-in failed: ${reason}`)
  }
}
```

- **`SignInExpired`**, a `ValidationError` (400): the browser came back with no
  sign-in cookie, because it took more than ten minutes, or it was another browser,
  or the `state` is not the one in the cookie.
- **`SignInDenied`**, a `ForbiddenError` (403): auth sent the browser back with an
  `error` instead of a code. The person said no, or may not enter the product.
- **`SignInFailed`**, an `UnauthorizedError` (401): auth would not trade the code, or
  the token it gave says nothing of this client.

A person never sees these as JSON: the callback is a page the browser opens, so the
route turns them into a redirect (below).

## Its options

What a context tells the module:

```ts
// cooper/backend/shared/web-session/web-session-options.ts
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
```

The module does not import auth. It is given two functions instead:

- **`identify`**: who an access token acts for. boards hands it auth's
  `token.verify`, a use case it calls in the same process.
- **`profile`**: what `GET /api/session` answers for the signed-in person. Each
  context chooses what its UI shows.

So the module is the same for boards and the backoffice, and a test can give it any
context.

## The module

```ts
// cooper/backend/shared/web-session/web-session.module.ts
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

/** Only a path of the context itself: never another host (`//evil.example`). */
export const ownPath = (path: string | undefined) => (path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/')

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
```

Its five use cases:

- **`begin`** makes the `state` and the PKCE verifier, both `SecretToken.generate()`,
  and the challenge, the verifier's SHA-256 in base64url (`S256`). It answers where to
  send the browser, auth's `/oauth/authorize` with the client's id, its redirect URI,
  the challenge and the state, and `pending`, what the sign-in cookie keeps: the
  state, the verifier and `returnTo`, as JSON in base64url. Nothing is written to the
  store: a sign-in that never comes back leaves nothing behind.
- **`complete`** is the callback. It reads the cookie back and compares its `state`
  with the one auth sent, before anything else: a callback this browser did not start
  is `SignInExpired`, whatever it carries. Then it trades the code at `/oauth/token`,
  with the verifier, and asks `identify` who the access token is for. The answer must
  be for this client's product: a token for another product is `SignInFailed`. boards
  keeps no token: knowing who signed in was all it needed. So it gives the refresh
  token back at `/oauth/revoke`, which revokes the access token too. Then it opens its
  own `WebSession` and answers the token for the cookie.
- **`authenticate`**: who sent a request, from the token in the cookie. An expired
  session is closed on the way, and nobody is signed in.
- **`me`**: the signed-in person, as `profile` describes them. It is not public, so
  `currentActor()` is always there.
- **`signOut`** closes the session of the token, if there is one: signing out twice is
  signing out once.

A few details:

- **`retryOnConflict: false` on `complete`.** In chapter [8](./08-two-people-one-card)
  a use case is run again on a `ConcurrencyConflict`. This one calls auth over HTTP
  before it saves, and a code can be traded only once: a second run would bring the
  spent code back, and auth would answer as for a stolen one (chapter 21: a code
  brought again revokes what it gave). A new session never conflicts anyway, but the
  use case says it must not run twice.
- **`post`** sends a form to auth as this client, with `client_secret_basic`: the
  client's id and secret in an `Authorization: Basic` header, each URL-encoded first.
  It goes over HTTP to auth's public URL, as it would if auth were another company's
  server. A refusal from auth becomes `SignInFailed`, with auth's
  `error_description`.
- **`ownPath`** keeps `returnTo` a path of the context itself. A link to
  `sign-in?returnTo=//evil.example` must not send the person, signed in, to another
  site after the callback: `//host` is another host to a browser, and so is `/\host`.
  Anything that is not a plain path becomes `/`.
- **`find`** checks the cookie's value with `SecretToken.schema` before looking it
  up: a cookie that is not a token finds nothing, without a query.

## Its routes, and the authenticator

```ts
// cooper/backend/shared/web-session/web-session.routes.ts
import type { BunRequest } from 'bun'
import { DomainError } from 'newt/core'
import type { CooperBase } from '../cooper-base'
import { ownPath, type WebSession_Module } from './web-session.module'
import type { WebSession_Options } from './web-session-options'
import { webSessionCookies, type WebSessionSignOutDTO } from './web-session.schema'

/** How long a sign-in may take, from leaving for auth to coming back. */
const SIGN_IN_SECONDS = 10 * 60

/** A redirect to a path of this same origin. */
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

export function registerWebSessionRoutes(base: CooperBase, sessions: WebSession_Module, options: WebSession_Options): void {
  const cookies = webSessionCookies(options.context)
  const secure = new URL(options.publicUrl).protocol === 'https:'

  // Every route of the context runs as whoever its session cookie says.
  base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(cookies.session) ?? undefined))

  base.http.get('/session/sign-in', async request => {
    const { location, pending } = await sessions.begin(new URL(request.url).searchParams.get('returnTo') ?? undefined)
    // Sent back only to the callback, and only for a while.
    request.cookies.set(cookies.signIn, pending, { httpOnly: true, sameSite: 'lax', secure, path: '/api/session', maxAge: SIGN_IN_SECONDS })
    return redirect(location)
  }, { public: true })

  // Where auth sends the browser back. A sign-in that did not finish goes to the
  // frontend's start, which says why (`?signInError=<code>`).
  base.http.get('/session/callback', async request => {
    const query = new URL(request.url).searchParams
    const pending = request.cookies.get(cookies.signIn) ?? undefined
    request.cookies.delete({ name: cookies.signIn, path: '/api/session' })
    try {
      const { token, returnTo } = await sessions.complete({
        code: query.get('code') ?? undefined,
        state: query.get('state') ?? undefined,
        error: query.get('error') ?? undefined,
        errorDescription: query.get('error_description') ?? undefined,
        pending,
      })
      keep(request, token)
      return redirect(returnTo)
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      return redirect(`/?${new URLSearchParams({ signInError: error.code })}`)
    }
  }, { public: true })

  base.http.get('/session', async () => Response.json(await sessions.me()))

  // Public: signing out with a session already gone still clears the cookie. The
  // browser goes on to auth, to sign out there too and come back: otherwise signing
  // in again would sign the same person in, with no way to switch accounts. It comes
  // back to `?returnTo=` (a path of this context: an invitation, say) or to the start.
  base.http.post('/session/sign-out', async request => {
    await sessions.signOut(request.cookies.get(cookies.session) ?? undefined)
    request.cookies.delete({ name: cookies.session, path: '/' })
    const returnTo = new URL(request.url).searchParams.get('returnTo')
    const back = returnTo ? new URL(ownPath(returnTo), options.publicUrl).toString() : options.publicUrl
    const next = `${options.authUrl}/oauth/logout?${new URLSearchParams({ redirect: back })}`
    return Response.json({ next } satisfies WebSessionSignOutDTO)
  }, { public: true })

  /** The session lives in a cookie the page's scripts cannot read, sent only to this context. */
  function keep(request: BunRequest, token: string) {
    request.cookies.set(cookies.session, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: options.days * 24 * 60 * 60 })
  }
}
```

**The authenticator is set by the module.** A router has one authenticator: the
function that tells who sent each request, `null` when nobody did. Each call to
`authenticateWith` replaces the one before, and the last one set is the one used. Its
first line here gives boards' router the web session's: every route of boards that is
not public now runs as whoever the cookie says, and a request without a valid cookie
gets a 401, `not_signed_in`, before the route runs. auth's session module did the same
for auth in chapter 17. The module that knows the sessions sets it; nothing else
needs to.

The four routes:

- **`GET /session/sign-in`** is public: nobody is signed in yet. It sets the sign-in
  cookie and answers a 302 to auth. The cookie is sent back only to paths under
  `/api/session`, and lasts ten minutes (`SIGN_IN_SECONDS`).
- **`GET /session/callback`** is public too. It deletes the sign-in cookie first: the
  cookie is used once, whatever happens next. On success it sets the session cookie
  and redirects to `returnTo`. A `DomainError` (the three above) becomes a redirect to
  `/?signInError=<code>`, the frontend's start, which says what went wrong. Any other
  error is not the person's: it is rethrown, and answered as a 500.
- **`GET /session`** is the signed-in person. It is not public.
- **`POST /session/sign-out`** is public, as auth's was: someone whose session already
  ended still gets their cookie cleared. It answers `{ next }`: auth's
  `/oauth/logout`, which ends auth's session too and sends the browser back to
  boards. Without that, signing in again would sign the same person in at auth without
  asking, and nobody could switch accounts. `?returnTo=` (an invitation's page, say)
  is where auth sends the browser back, kept a path of boards by `ownPath`.

`keep` sets the session cookie with the attributes of chapter 17's: `httpOnly`,
`sameSite: 'lax'`, `secure` when the context's public URL is https, path `/`, and as
long as the session. `sameSite: 'lax'` is what lets the cookie arrive at all on the
callback: it is a top-level navigation from auth's site, which `lax` allows and
`strict` would not.

## boards signs in through it

boards initializes the module first in `initializeModules`, and hands it auth's
`token` through `Boards_Auth`. Add the three imports (`Auth_Modules` comes back, for
`token`):

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
// …
```

make `Boards_Auth` what the workspace module asks of auth, `WorkspaceAuth`, and auth's
`token` module besides:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
// …
/**
 * auth's use cases `boards` calls besides its ports: who an access token is for (the
 * web session, the MCP server), and what its workspace module asks of auth (who
 * someone is, and what boards' routes for workspaces, members and invitations manage
 * in auth).
 */
export type Boards_Auth = WorkspaceAuth & Pick<Auth_Modules, 'token'>
// …
```

and initialize the session before the other modules, returning it with them:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
// …
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  // Its people sign in through auth: boards is the OAuth client of the product `cooper`.
  const session = WebSession_Module.initialize(base, {
    context: 'boards',
    clientId: WORKSPACES_PRODUCT,
    clientSecret: config.clientSecret,
    publicUrl: config.publicUrl,
    authUrl: config.authPublicUrl,
    days: config.sessionDays,
    identify: accessToken => deps.auth.token.verify(accessToken),
    // `GET /api/session`: who is signed in, and only what boards' UI shows of them.
    profile: async userId => {
      const { id, name, email } = await deps.auth.user.get(userId)
      return { user: { id, name, email } }
    },
  })
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
// …
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { session, member, board, column, card, workspace, activity, outbox }
}
```

- **`clientId: WORKSPACES_PRODUCT`** is `'cooper'`, the product whose client auth
  declared in chapter 21. Its redirect URI there is `boardsPublicUrl` and
  `WEB_SESSION_CALLBACK`; here the module builds it from `publicUrl` and the same
  constant. Both come from the same `publicUrls.boards`, so they match.
- **`identify`** is auth's `token.verify`: it answers `{ userId, productId, … }` for
  a valid access token, and `null` otherwise.
- **`profile`** gives boards' UI the account's id, name and email, under `user`, and
  nothing more of what auth keeps.

The lint already lets boards import from auth (chapter [20](./20-wiring-contexts)),
and `shared/` is anyone's.

`openContexts` hands boards auth's `token`, in `boardsOnAuth`:

```ts
// cooper/backend/open-contexts.ts
// …
function boardsOnAuth(auth: Auth_Context): Omit<Boards_ModuleDeps, 'mailer' | 'search' | 'log'> {
  const { access, user, tenant, token, invitation } = auth.modules
// …
    auth: { token, user, tenant, access, invitation },
  }
}
```

## The clock reaches boards

Chapter [19](./19-invitations-and-time) gave auth a clock. boards had no use for one:
nothing in it expired. Its sessions do now. `Boards_Context.open` takes a clock and
hands it to its base, as `Auth_Context.open` does:

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
// …
/**
 * The SaaS: each workspace's boards, their columns and cards. Its people sign in
 * through `auth`, which also keeps the workspaces and who belongs to each: `boards`
 * asks it through ports it is handed when it opens, and calls its use cases.
 */
// …
  /** Opened after `auth`, which it uses; on the real time, unless a test gives it a `clock`. */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, clock?: Clock): Promise<Boards_Context> {
    // Brought up to date as it opens: the migrations it has not run yet, in order.
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new BoardsBase({ name: 'boards', store, clock })
// …
```

and `openContexts` gives boards the same clock as auth:

```ts
// cooper/backend/open-contexts.ts
// …
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, search: new MemoryCardSearch(), log: line => console.log(line) }, clock)
// …
```

One clock for every context. A test that moves it a month ahead moves auth's sessions
and boards' together: they cannot disagree about what time it is. Without a clock,
boards runs on the real time, as before.

## The `x-user` header goes

`index.ts` loses the authenticator it set on boards in chapter 2. The web-session
module sets boards' now. Replace it:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { config } from './config'
import { openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })))
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)
```

The served context's comment says why each context's sessions are its own:

```ts
// cooper/backend/shared/served-context.ts
// …
/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain, so its sessions (cookies) are its own too. It answers `GET /api/health`
 * without a session, for whoever watches it is up.
 */
// …
```

boards' own tests are the one place the header stays. They run boards against
`FakeAuth`, with no auth to sign in at, and they are about boards' rules, not about
signing in. `openTestBoards` already set an `x-user` authenticator. Since the module
now sets the web session's when the context opens, the test's call comes after it and
replaces it: the last one set wins. Only its comment changes:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
// …
/**
 * `boards` for a test: its database and its cards' search in memory, a fake auth
 * behind its ports, its emails and its log's lines in lists, and who sends a request
 * told by an `x-user` header (the real authenticator, the web session's, is replaced).
 */
// …
```

`FakeAuth`'s `modules` is a Proxy (chapter 20), so it stands in for a `Boards_Auth`
with `token` without a change. boards' own tests never sign in, so they never call it.

## Testing a sign-in: `newt/testing`

A sign-in is a round trip between two servers, through redirects and cookies. A test
of it needs two things `fetch` does not give, and **`newt/testing`** does.

**`browser(baseUrl?)`** is one person's browser: a `fetch` with a cookie jar. The
module's test (below) starts each sign-in with it:

```ts
const as = browser()
const started = await as(clientUrl(`/api/session/sign-in?returnTo=${encodeURIComponent(returnTo)}`))
expect(started.status).toBe(302)
const authorize = started.headers.get('location')!
expect(authorize).toStartWith(authUrl('/oauth/authorize?'))
```

- It keeps the cookies each host sets, sends them back to that host, and forgets
  those a server deletes (an empty value, `Max-Age=0`, or an expiry in the past).
- It **never follows a redirect** (`redirect: 'manual'`). The test sees each 302 and
  its `Location`, and opens it itself when it wants to. A sign-in is a chain of
  redirects; the test checks every link.
- `json` sends a body as JSON, with its content type.
- Its jars are by **host**, port included. A real browser keeps cookies by host name
  only, which is why the cookies carry the context's name; in a test, two servers on
  two ports never see each other's cookies at all.
- Two calls to `browser()` are two people: a second one has none of the first one's
  cookies. That is how a test shows that a stranger cannot finish someone else's
  sign-in.

**`freePort()`** is a port nobody listens on now. The servers of a sign-in must know
their addresses before they start: auth names itself in its OAuth metadata, boards'
redirect URI has its port in it, and each context's configuration names the other's
public URL. Port 0, "any free port", is only known once the server is up, too late.
`freePort` opens a server on port 0, reads its port and closes it.

Chapter 20's `cooper.test.ts` already used both, with a stand-in `signUp`. It now
signs people in as boards' UI will.

### cooper's test signs in through boards

In `cooper.test.ts`, each context now names the other's public URL:

```ts
// cooper/backend/cooper.test.ts
// …
function testConfig(authPort: number, boardsPort: number): Config {
  const [authUrl, boardsUrl] = [`http://localhost:${authPort}`, `http://localhost:${boardsPort}`]
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: authPort, publicUrl: authUrl, boardsPublicUrl: boardsUrl },
    boards: { ...config.boards, database: ':memory:', port: boardsPort, publicUrl: boardsUrl, authPublicUrl: authUrl },
  }
}
// …
```

With no Vite in front, each context's public URL is its own server: `freePort` gives
both ports before anything opens. `beforeEach` no longer sets an `x-user`
authenticator on boards; boards has the web session's:

```ts
// cooper/backend/cooper.test.ts
// …
beforeEach(async () => {
  const mailer = new RecordingMailer()
  mails = mailer.mails
  contexts = await openContexts(testConfig(freePort(), freePort()), { mailer })
  servers = [serve(contexts.auth.serving()), serve(contexts.boards.serving())]
})
// …
```

Add `authUrl` next to `boardsUrl`, and replace `signUp`:

```ts
// cooper/backend/cooper.test.ts
// …
const authUrl = (path: string) => new URL(path, contexts.auth.config.publicUrl).toString()
const boardsUrl = (path: string) => new URL(path, contexts.boards.config.publicUrl).toString()
// …
/** Someone signs up to cooper from boards, as its UI does it: boards' sign-in, auth's pages, back to boards. */
async function signUp(email: string, name: string): Promise<{ as: Browser, id: string }> {
  const as = browser()
  const started = await as(boardsUrl('/api/session/sign-in?returnTo=/'))
  const kept = await as(started.headers.get('location')!)
  const request = kept.headers.get('location')!.split('/authorize/')[1]!
  const user = (await (await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email, name, password: 'a long password' } })).json()) as { id: string }
  const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${request}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
  expect((await as(redirectTo)).headers.get('location')).toBe('/')
  return { as, id: user.id }
}
// …
```

Each line is a step of the sign-in, as a person's browser takes it:

1. boards' sign-in: a 302 to auth's `/oauth/authorize`, and the sign-in cookie in the
   jar for boards' host.
2. auth's `/oauth/authorize` keeps the request and sends the browser to its page,
   `/authorize/<id>`. The test takes the id.
3. The sign-up at auth, what its page will post: an account, and auth's session
   cookie in the jar for auth's host.
4. The approval, what auth's page will post when the person says yes: auth answers
   where the browser goes, boards' callback with a code.
5. The callback: boards trades the code, sets its session cookie, and sends the
   browser to `/`.

From then on `as` is that person on both servers. Every other test of the file uses
`signUp` and `call` as before, unchanged: they ran as an `x-user` header, and now as a
session cookie. The first one also asks who is signed in:

```ts
// cooper/backend/cooper.test.ts
// …
    const { as, id } = await signUp('ana@cooper.test', 'Ana')
    expect(await call(as, 'GET', '/session')).toEqual({ status: 200, body: { user: { id, name: 'Ana', email: 'ana@cooper.test' } } })
// …
```

### The module's own test

The web session is shared code: its test does not use boards. It makes a context of
its own, `Client_Context`, with the module, the module's own migration folder, and one
route that answers who is asking:

```ts
// cooper/backend/shared/web-session/web-session.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Server } from 'bun'
import { SqliteStore } from 'newt/adapter-sqlite'
import { currentActor } from 'newt/core'
import { serve } from 'newt/http'
import { browser, freePort } from 'newt/testing'
import { config } from '../../config'
import { Auth_Context } from '../../contexts/auth/auth.context'
import { CooperBase } from '../cooper-base'
import { ServedContext } from '../served-context'
import { WebSession_Module } from './web-session.module'

/**
 * A context that signs its people in through auth, as boards does: the product
 * `cooper`'s client, with the web-session module, its migration, and one route that
 * says who is asking.
 */
class Client_Context extends ServedContext {

  private constructor(base: CooperBase, readonly session: WebSession_Module, port: number) {
    super('client', base, { port })
  }

  static async open(port: number, auth: Auth_Context): Promise<Client_Context> {
    const store = await SqliteStore.open({ path: ':memory:', migrations: join(import.meta.dir, 'migrations/sqlite') })
    const base = new CooperBase({ name: 'client', store })
    const session = WebSession_Module.initialize(base, {
      context: 'client',
      clientId: 'cooper',
      clientSecret: config.auth.clientSecrets.cooper,
      publicUrl: `http://localhost:${port}`,
      authUrl: auth.config.publicUrl,
      days: 1,
      identify: accessToken => auth.modules.token.verify(accessToken),
      profile: userId => auth.modules.user.get(userId),
    })
    base.http.get('/whoami', async () => Response.json(currentActor()))
    return new Client_Context(base, session, port)
  }
}

let auth: Auth_Context
let client: Client_Context
let servers: Server<undefined>[]

beforeEach(async () => {
  const [authPort, clientPort] = [freePort(), freePort()]
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port: authPort, publicUrl: `http://localhost:${authPort}`, boardsPublicUrl: `http://localhost:${clientPort}` }, { mailer: { send: async () => {} } })
  client = await Client_Context.open(clientPort, auth)
  servers = [serve(auth.serving()), serve(client.serving())]
})

afterEach(async () => {
  await Promise.all(servers.map(server => server.stop()))
  await client.stop()
  await auth.stop()
})

const authUrl = (path: string) => new URL(path, auth.config.publicUrl).toString()
const clientUrl = (path: string) => new URL(path, `http://localhost:${servers[1]!.port}`).toString()

/** From the client's sign-in to auth's UI: the browser, and the id of the request auth shows. */
async function startSignIn(returnTo = '/boards/1') {
  const as = browser()
  const started = await as(clientUrl(`/api/session/sign-in?returnTo=${encodeURIComponent(returnTo)}`))
  expect(started.status).toBe(302)
  const authorize = started.headers.get('location')!
  expect(authorize).toStartWith(authUrl('/oauth/authorize?'))
  const kept = await as(authorize)
  const id = kept.headers.get('location')!.split('/authorize/')[1]!
  return { as, id }
}

describe('the web session of a context', () => {
  test('signs the person in through auth, and keeps its own session', async () => {
    const { as, id } = await startSignIn()

    // In auth: who asks, the person signs up, and auth's UI says yes for a product's own client.
    expect(await (await as(authUrl(`/api/authorizations/${id}`))).json()).toMatchObject({ firstParty: true, product: { id: 'cooper' } })
    const ana = (await (await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password', productId: 'cooper' } })).json()) as { id: string }
    const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${id}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
    expect(redirectTo).toStartWith(clientUrl('/api/session/callback?code='))

    // Back in the client: the code is traded over HTTP, and the browser goes where it was going.
    const back = await as(redirectTo)
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/boards/1')
    expect(await (await as(clientUrl('/api/session'))).json()).toMatchObject({ id: ana.id, email: 'ana@cooper.test' })
    expect(await (await as(clientUrl('/api/whoami'))).json()).toEqual({ userId: ana.id, via: 'web' })
    // It keeps no token: it gave them back once it knew who signed in.
    expect(await auth.base.store.table('token').count()).toBe(0)

    // The same callback again opens nothing: the sign-in it answered (its cookie) is over, so it
    // is told expired before its code goes to auth (which refuses a spent one: oauth.test.ts).
    expect(new URL((await as(redirectTo)).headers.get('location')!, clientUrl('/')).searchParams.get('signInError')).toBe('session.sign_in_expired')

    // Signing out goes on to auth, which ends its own session too and sends the browser back.
    const { next } = (await (await as(clientUrl('/api/session/sign-out'), { method: 'POST' })).json()) as { next: string }
    expect(next).toBe(authUrl(`/oauth/logout?${new URLSearchParams({ redirect: `http://localhost:${servers[1]!.port}` })}`))
    expect((await as(clientUrl('/api/session'))).status).toBe(401)
    expect((await as(clientUrl('/api/whoami'))).status).toBe(401)
    const loggedOut = await as(next)
    expect(loggedOut.headers.get('location')).toBe(clientUrl('/'))
    expect((await as(authUrl('/api/session'))).status).toBe(401)

    // Signing out on the way somewhere comes back there: a path of the client, never another host.
    const { next: toInvitation } = (await (await as(clientUrl('/api/session/sign-out?returnTo=/invitations/abc'), { method: 'POST' })).json()) as { next: string }
    expect((await as(toInvitation)).headers.get('location')).toBe(clientUrl('/invitations/abc'))
    const { next: elsewhere } = (await (await as(clientUrl(`/api/session/sign-out?returnTo=${encodeURIComponent('//evil.example/x')}`), { method: 'POST' })).json()) as { next: string }
    expect((await as(elsewhere)).headers.get('location')).toBe(clientUrl('/'))
  })

  test('refuses a callback that is not the answer to its own sign-in', async () => {
    const { as, id } = await startSignIn()
    await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' } })
    const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${id}/approve`), { method: 'POST' })).json()) as { redirectTo: string }

    // Another browser, which never started this sign-in, cannot finish it.
    const stranger = await browser()(redirectTo)
    expect(stranger.headers.get('location')).toBe('/?signInError=session.sign_in_expired')
    const forged = new URL(redirectTo)
    forged.searchParams.set('state', 'not the state')
    expect((await as(forged.toString())).headers.get('location')).toBe('/?signInError=session.sign_in_expired')
  })

  test('says so when the person says no, and never sends the browser elsewhere', async () => {
    const { as, id } = await startSignIn('//evil.example/steal')
    await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' } })
    const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${id}/deny`), { method: 'POST' })).json()) as { redirectTo: string }
    expect((await as(redirectTo)).headers.get('location')).toBe('/?signInError=session.sign_in_denied')

    const again = await startSignIn('//evil.example/steal')
    await again.as(authUrl('/api/session/sign-in'), { method: 'POST', json: { email: 'ana@cooper.test', password: 'a long password' } })
    const approved = (await (await again.as(authUrl(`/api/authorizations/${again.id}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
    expect((await again.as(approved.redirectTo)).headers.get('location')).toBe('/')
  })
})
```

- **`Client_Context`** passes as boards: it is the client `cooper`, and auth is opened
  with `boardsPublicUrl` set to the client's URL, so the redirect URI auth declares is
  the client's. It opens its store with `shared/web-session/migrations/sqlite`, the
  folder each context copies from: the test proves those files make the table the
  module needs.
- **The first test** walks the whole sign-in: the request auth shows is the product's
  own client (`firstParty`), the code comes back, the browser goes to `returnTo`, and
  `/api/whoami` runs as the person, `via: 'web'`. auth's `token` table is empty
  afterwards: the client gave its tokens back. The same callback a second time opens
  nothing: the sign-in it answered, its cookie, is over, so the client says
  `session.sign_in_expired` before the code goes to auth. That auth refuses a spent
  code is `oauth.test.ts`'s to show ([chapter 21](./21-oauth-server)). Signing out
  ends both sessions, and `returnTo` on the way out stays a path of the client.
- **The second** brings the callback from another browser, then with a forged
  `state`: both are `session.sign_in_expired`.
- **The third** says no at auth (`/deny`), and starts the sign-in with
  `returnTo=//evil.example/steal`: after a real sign-in the browser lands on `/`.

## Check it

Run the check:

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 114 pass
 0 fail
```

Then sign in by hand, with `curl` as the browser and a file as its cookie jar. Until
chapter 23 the public URLs point at Vite servers that do not exist yet, so start the
backend with each context's public URL at its own port:

```sh
COOPER_AUTH_PUBLIC_URL=http://localhost:3001 COOPER_BOARDS_PUBLIC_URL=http://localhost:3002 bun cooper/backend/index.ts
```

boards applies its new migration to `data/cooper-boards.db` as it opens. In another
terminal, first the header that used to work:

```sh
curl -i -H 'x-user: x' localhost:3002/api/workspaces
```

```text
HTTP/1.1 401 Unauthorized
…
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

Start a sign-in. `-c jar.txt -b jar.txt` keeps the cookies in `jar.txt` and sends them
back:

```sh
curl -si -c jar.txt -b jar.txt 'localhost:3002/api/session/sign-in?returnTo=/'
```

```text
HTTP/1.1 302 Found
Location: http://localhost:3001/oauth/authorize?response_type=code&client_id=cooper&redirect_uri=http%3A%2F%2Flocalhost%3A3002%2Fapi%2Fsession%2Fcallback&code_challenge=32WzqL3Ob9mqzvDRCPm-Qb55pz4fmZhAER7hP6nDce4&code_challenge_method=S256&state=5IGuhE252rSpAwufpJPLTe92GWyXBecgLOrCcywcpYs
Set-Cookie: cooper_boards_sign_in=eyJzdGF0ZSI6…; Path=/api/session; Max-Age=600; HttpOnly; SameSite=Lax
```

Your state, challenge and ids differ from these. Open the `Location` at auth:

```sh
curl -si -c jar.txt -b jar.txt '<the Location above>'
```

```text
HTTP/1.1 302 Found
Location: http://localhost:3001/authorize/01a17968-de04-774c-942f-e4912b560deb
```

That is auth's page, which chapter 23 serves. Do what it will do: sign up, then
approve the request with its id.

```sh
curl -s -c jar.txt -b jar.txt -X POST localhost:3001/api/session/sign-up \
  -H 'content-type: application/json' \
  -d '{"email":"ana@cooper.test","name":"Ana","password":"a long password"}'
curl -s -c jar.txt -b jar.txt -X POST localhost:3001/api/authorizations/01a17968-de04-774c-942f-e4912b560deb/approve
```

```text
{"id":"01a17968-de64-7767-90e1-90437632728e","email":"ana@cooper.test","name":"Ana",…}
{"redirectTo":"http://localhost:3002/api/session/callback?code=cooper_ac_tMJbUYIKYQpofD5xNwBTGgx6AHYML_UnRhtfzspbRug&state=5IGuhE252rSpAwufpJPLTe92GWyXBecgLOrCcywcpYs"}
```

Follow `redirectTo` back to boards:

```sh
curl -si -c jar.txt -b jar.txt '<the redirectTo above>'
```

```text
HTTP/1.1 302 Found
Location: /
Set-Cookie: cooper_boards_sign_in=; Path=/api/session; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
Set-Cookie: cooper_boards_session=fldknEx6JAPPCLvGfGkMN6I12PNKtMvneE_63q_FdPw; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax
```

The sign-in cookie is gone, and boards' session cookie is set for thirty days. Ask
boards who you are, and for your workspaces:

```sh
curl -s -b jar.txt localhost:3002/api/session
curl -s -b jar.txt localhost:3002/api/workspaces
```

```text
{"user":{"id":"01a17968-de64-7767-90e1-90437632728e","name":"Ana","email":"ana@cooper.test"}}
[]
```

Ana has no workspace yet. The jar now holds two sessions, one per context, and no
token of auth's:

```sh
grep _session jar.txt
```

```text
#HttpOnly_localhost	FALSE	/	FALSE	1795630278	cooper_auth_session	acjJrN3bDv5qVMyboqEe3i3nl_mcv18LQ4HL2PeWn9U
#HttpOnly_localhost	FALSE	/	FALSE	1795630278	cooper_boards_session	fldknEx6JAPPCLvGfGkMN6I12PNKtMvneE_63q_FdPw
```

Behind them, boards keeps only the hash of its token, and auth keeps no token for
boards' client: boards gave them back.

```sh
sqlite3 data/cooper-boards.db "SELECT user_id, token_hash FROM session"
sqlite3 data/cooper-auth.db "SELECT count(*) FROM token"
```

```text
01a17968-de64-7767-90e1-90437632728e|6e1a8877cb9427cd0d09a431c4faaff2829d84a21ef15d650afcfaa20d42c464
0
```

Open the same callback a second time: the sign-in cookie was used, and nothing opens.

```sh
curl -si -c jar.txt -b jar.txt '<the redirectTo above>'
```

```text
HTTP/1.1 302 Found
Location: /?signInError=session.sign_in_expired
```

Last, sign out:

```sh
curl -si -c jar.txt -b jar.txt -X POST localhost:3002/api/session/sign-out
curl -si -b jar.txt localhost:3002/api/session
```

```text
HTTP/1.1 200 OK
Set-Cookie: cooper_boards_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
…
{"next":"http://localhost:3001/oauth/logout?redirect=http%3A%2F%2Flocalhost%3A3002"}
HTTP/1.1 401 Unauthorized
…
```

`next` is where a browser goes on to end auth's session too. Stop the server
(Ctrl-C) and remove `jar.txt`.

## What to remember

- A context that signs people in through auth is an OAuth confidential client, and
  its **server** does the OAuth. The browser holds only the context's own session
  cookie: no token, and no secret, ever reaches the page.
- The callback trusts only what the browser brought back in its own sign-in cookie:
  the `state` must match, and the PKCE verifier proves the code is the one asked for.
  `returnTo` is always a path of the context itself.
- A router has one **authenticator**, and the module that knows the sessions sets it.
  The last one set wins: a test that wants another sets its own after the context
  opens.
- Shared code with a table brings its migration, and each context copies it into its
  own, numbered after the ones it has. The code is shared; the rows are each
  context's.
- **`newt/testing`**: `browser()` keeps each host's cookies and never follows a
  redirect, so a test walks a sign-in step by step; `freePort()` gives a server its
  port before it opens, for servers that must name each other.

Next: [The frontends and newt/contract](./23-frontends).
