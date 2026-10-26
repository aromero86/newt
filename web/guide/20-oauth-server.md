# An OAuth server with newt

People sign in to boards and to the backoffice. AI assistants connect to boards' MCP
server on someone's behalf. All of them need the same answer: who is this? cooper
answers it in one place, auth, which is an **OAuth 2.1 authorization server**. Every
app is an OAuth client of it, and so is every MCP client.

This chapter is not an OAuth course. It shows how an OAuth server is built with
newt's usual pieces: modules, entities, use cases, workers, and routes that speak
OAuth's wire format.

## auth's modules

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
export function initializeModules(base: AuthBase, config: Auth_Config, deps: Auth_ModuleDeps) {
  const product = Product_Module.initialize(base, { products: declaredProducts(config) })
  const user = User_Module.initialize(base)
  const session = Session_Module.initialize(base, { user, product }, { days: config.sessionDays })
  const access = Access_Module.initialize(base, { product })
  const tenant = Tenant_Module.initialize(base, { access }, { productId: WORKSPACES_PRODUCT })
  const invitation = Invitation_Module.initialize(base, { tenant, access, user }, {
    // …
  })
  const oauthClient = OauthClient_Module.initialize(base, { product }, { secrets: config.clientSecrets })
  const oauthGrant = OauthGrant_Module.initialize(base, { oauthClient, product, access }, { publicUrl: config.publicUrl })
  const token = Token_Module.initialize(base, { oauthClient, oauthGrant }, config.oauth)
  return { product, user, session, access, tenant, invitation, oauthClient, oauthGrant, token }
}
```

| Module | What it keeps |
|---|---|
| `product` | The apps that sign people in: `cooper` (boards) and `backoffice`. Declared in code. |
| `user` | Accounts: email, name, password hash. |
| `session` | auth's own browser session, after signing in on auth's pages. |
| `access` | Who may enter which product: per workspace for `cooper`, for all of it for `backoffice`. |
| `tenant` | The workspaces of `cooper`. |
| `invitation` | Invitations to a workspace. |
| `oauthClient` | OAuth clients: each product's own, and MCP clients that register themselves. |
| `oauthGrant` | Authorization requests, the person's answer, and the code. |
| `token` | Access and refresh tokens. |

## Users and auth's own session

A user is an email (newt's `Email` value object), a name and a password hash
(`Bun.password`). Checking a password takes as long for an unknown email as for a
wrong password, so timing says nothing:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
/**
 * A hash to check a password against when there is no account: signing in with an
 * unknown email takes as long as with a wrong password, so the time says nothing.
 */
const NOBODY = await Bun.password.hash('nobody has this password')

// …

/** The account of this email if the password is its own; null otherwise, as slowly either way. */
@UseCase()
async verifyPassword(email: string, password: string): Promise<UserDTO | null> {
  const parsed = Email.schema.safeParse(email.trim().toLowerCase())
  const user = parsed.success ? await this.repo.first({ email: parsed.data }) : undefined
  const matches = await Bun.password.verify(password, user?.passwordHash ?? NOBODY)
  return user && matches ? user.contract() : null
}
```

`session` keeps auth's own cookie, on auth's origin. It is the router's
authenticator: every route of auth's API runs as whoever that cookie says. One
session on auth signs the person in to every product: each product then opens a
session of its own through OAuth.

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
static initialize(base: AuthBase, deps: Session_Deps, options: Session_Options): Session_Module {
  const module = new Session_Module(base, new Session_Repository(base), deps, options)
  base.http.authenticateWith(request => module.authenticate(request.cookies.get(SessionCookie) ?? undefined))
  registerSessionRoutes(base, module)
  return module
}
```

## Products, declared in code

A product is a piece of the system, not data anyone edits. So cooper declares its
products in code, and the `product` module has no entity and no repository:

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
export function declaredProducts(config: Auth_Config): ProductDTO[] {
  return [
    {
      id: WORKSPACES_PRODUCT,
      name: 'Cooper',
      publicUrl: config.boardsPublicUrl,
      signUp: true,
      access: 'anyone',
      mcpResource: `${config.boardsPublicUrl}/mcp`,
      redirectUri: `${config.boardsPublicUrl}${WEB_SESSION_CALLBACK}`,
    },
    {
      id: 'backoffice',
      name: 'Cooper backoffice',
      publicUrl: config.backofficePublicUrl,
      signUp: false,
      access: 'granted',
      mcpResource: null,
      redirectUri: `${config.backofficePublicUrl}${WEB_SESSION_CALLBACK}`,
    },
  ]
}
```

- `signUp`: whether someone may create an account on the way to it.
- `access`: `'anyone'` with an account may enter, or only those `'granted'` access
  (the staff, for the backoffice).
- `mcpResource`: the address of its MCP server, if it has one. MCP clients ask for
  tokens for that resource.

A module without a store is still a module: its use cases are what other modules
call (`product.get`, `product.forResource`).

## Tenants and access

A workspace is a **tenant**; who belongs to it is an **access** `(userId, productId,
tenantId)`. `cooper` access is per tenant. `backoffice` access has `tenantId: null`:
it opens the whole product. `access.check` is what every context asks before letting
someone in, every time:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
/**
 * Someone's access to a product, for a tenant or (null) for all of it; null when they
 * have none. What every context asks before letting someone in.
 */
@UseCase()
async check(userId: string, productId: string, tenantId: string | null = null): Promise<AccessDTO | null> {
  return (await this.repo.first({ userId, productId, tenantId }))?.toDTO() ?? null
}
```

[Chapter 8](./08-rules-over-rows) covers the single admin per tenant, and
[chapter 16](./16-sagas) the deletion of a tenant across auth and boards.

## OAuth clients

There are two kinds:

- **A product's own client.** Confidential: it has a secret, kept on its server.
  Its `client_id` is the product's id. auth creates or updates them every time it
  opens, from the code and the configuration.
- **A registered client.** Public: an MCP client registers itself (RFC 7591), with
  no secret. It proves itself with PKCE.

```ts
// cooper/backend/contexts/auth/auth.context.ts
static async open(config: Auth_Config, deps: Auth_ModuleDeps): Promise<Auth_Context> {
  const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
  const base = new AuthBase({ name: 'auth', store })
  const modules = initializeModules(base, config, deps)
  await modules.oauthClient.declareProducts()
  return new Auth_Context(base, modules, config)
}
```

```ts
// cooper/backend/contexts/auth/modules/oauth-client/oauth-client.module.ts
/**
 * Each product's own client, as the product and the configuration say now: made the
 * first time auth starts, kept in step after. Safe to run on every start.
 */
@UseCase()
async declareProducts(): Promise<OauthClientDTO[]> {
  const clients: OauthClient[] = []
  for (const product of await this.deps.product.list()) {
    const secret = ClientSecret.from(this.options.secrets[product.id] ?? '')
    const declared = { name: product.name, redirectUri: product.redirectUri, secret }
    const existing = await this.repo.first({ clientId: product.id })
    if (existing) existing.reconfigure(declared)
    clients.push(existing ?? OauthClient.forProduct({ productId: product.id, ...declared }))
  }
  await this.repo.persist(...clients)
  return clients.map(client => client.contract())
}
```

The secret is a value object. The store keeps only its hash, compared in constant
time:

```ts
// cooper/backend/contexts/auth/modules/oauth-client/value-objects/client-secret.ts
/** Whether `presented` is the secret of this hash, in constant time: how long it takes says nothing. */
matches(presented: string, hash: string): boolean {
  return timingSafeEqual(Buffer.from(hashOf(presented), 'hex'), Buffer.from(hash, 'hex'))
},
```

Registration is open to anyone: a client opens nothing until a person says yes to
it. Its redirect addresses must be `https`, or `http` on localhost:

```ts
// cooper/backend/contexts/auth/modules/oauth-client/oauth-client.schema.ts
export const OauthClientRedirectUriSchema = z.url('Write a valid address').refine(uri => {
  const url = new URL(uri)
  if (url.hash) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname))
}, 'A redirect address is https, or http on localhost')
```

## Grants: the authorization code with PKCE

An `oauthGrant` is one authorization request, from the moment a client sends the
browser to auth until it trades the code:

1. **`request`**: the client sends the browser to `/oauth/authorize`. auth checks the
   client, its redirect address and the PKCE challenge (S256 only), keeps the
   request, and sends the browser to its own UI.
2. **`review`**: auth's UI shows who asks.
3. **`approve`** or **`deny`**: the signed-in person answers. A product's own client
   (first party) is approved by signing in; any other asks for consent. A product
   with `access: 'granted'` checks the person has access.
4. **`redeem`**: the client trades the code, once, with its PKCE verifier.

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.module.ts
@UseCase()
async approve(id: string): Promise<OauthGrantRedirectDTO> {
  const { userId } = currentActor()
  const grant = await this.load(id)
  if (!grant.is('pending')) throw new AuthorizationNotOpen()
  const product = await this.deps.product.get(grant.productId)
  if (product.access === 'granted' && !(await this.deps.access.check(userId, product.id, null))) throw new NoProductAccess(product.name)

  const code = grant.approve(userId)
  await this.repo.persist(grant)
  return { redirectTo: this.redirect(grant, { code }) }
}
```

The entity holds the OAuth rules. The code is generated with newt's `SecretToken`
and only its hash is kept. PKCE is a hash comparison:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.ts
/** The person said yes (or signed in to a product): the code only the client will hold. */
approve(userId: string): string {
  const code = SecretToken.generate()
  this.change({ status: 'approved', userId, codeHash: SecretToken.hash(code), expiresAt: minutesFromNow(CODE_MINUTES) })
  return `${CODE_PREFIX}${code}`
}

/** PKCE (RFC 7636 §4.6): only who started the request knows the verifier. */
isVerifiedBy(codeVerifier: string): boolean {
  return new Bun.CryptoHasher('sha256').update(codeVerifier).digest('base64url') === this.data.codeChallenge
}
```

A code brought a second time was copied (RFC 6749 §4.1.2). The grant is marked
`replayed`, with an event. A worker of `token` revokes whatever the code was traded
for: the irreversible part leaves from a worker, as always
([chapter 14](./14-irreversible)).

```ts
// cooper/backend/contexts/auth/modules/token/token.workers.ts
/** A code brought twice was copied: whatever it was traded for stops working, a moment later. */
export function registerTokenWorkers(tokens: Token_Module, deps: Token_Deps): void {
  deps.oauthGrant.events.replayed.subscribe(grant => tokens.revokeGrant(grant.id), {
    strategy: 'handler',
    queue: 'token.revokeGrant.on.oauthGrant.replayed',
  })
}
```

## Tokens

Tokens are **opaque**: random strings with a prefix (`cooper_at_`, `cooper_rt_`), so
people and secret scanners recognize them. The store keeps only their hashes. Any
context asks auth who a token is for, in-process, with `token.verify`.

```ts
// cooper/backend/contexts/auth/modules/token/token.module.ts
/**
 * A client trades its code for tokens. It writes to `oauthGrant` without being a
 * worker, on purpose: the client waits for its tokens in this answer. The code is
 * spent first, then the tokens saved; should that fail, the client signs the person
 * in again. It never runs again on a conflict: the code it spent would look copied.
 */
@UseCase({ writesTo: ['oauthGrant'], retryOnConflict: false })
async exchange(input: TokenExchangeDTO): Promise<TokenPairDTO> {
  const { clientId, clientSecret, code, codeVerifier, redirectUri } = TokenExchangeSchema.parse(input)
  const client = await this.deps.oauthClient.authenticate(clientId, clientSecret)
  const grant = await this.deps.oauthGrant.redeem({ code, codeVerifier, clientId: client.clientId, redirectUri })

  const { token, pair } = Token.issue(grant, this.options)
  await this.repo.persist(token)
  return pair
}

// …

/**
 * Who an access token acts for, and for which client, product and server; null when
 * it opens nothing. What every context asks before letting a request in with one.
 */
@UseCase()
async verify(accessToken: string): Promise<TokenVerifiedDTO | null> {
  const hash = Token.hashOf('access', accessToken)
  const token = hash ? await this.repo.first({ accessTokenHash: hash }) : undefined
  return token?.isAccessValid() ? token.verified() : null
}
```

`exchange` is a `writesTo` with its reasons ([chapter 17](./17-modules-talk)) and a
`retryOnConflict: false` ([chapter 7](./07-concurrency)): running it again would
present the spent code a second time, which looks exactly like a copied one.

Each refresh **rotates** both tokens. The refresh token it replaced, brought again,
was copied: `refresh` revokes the tokens.

## The endpoints

OAuth's endpoints are not part of auth's JSON API. They live outside `/api`, and
speak OAuth's wire format: a form in, `{ error, error_description }` out. So auth's
base has a second router, with its own prefix:

```ts
// cooper/backend/contexts/auth/auth-base.ts
export class AuthBase extends CooperBase {
  readonly oauth = new HttpRouter({ prefix: '/oauth' })
}
```

The context serves it beside its API, with the server's metadata (RFC 8414):

```ts
// cooper/backend/contexts/auth/auth.context.ts
protected override routes(): Bun.Serve.Routes<undefined, string> {
  const oauth = { ...this.auth.oauth.routes(), ...oauthServerMetadataRoutes(this.config.publicUrl) }
  return {
    ...super.routes(),
    ...openRoutesToBrowsers(oauth, ['/.well-known/oauth-authorization-server', '/oauth/register', '/oauth/token', '/oauth/revoke']),
  }
}
```

| Endpoint | What it does |
|---|---|
| `GET /.well-known/oauth-authorization-server` | Says where everything else is. |
| `GET /oauth/authorize` | `oauthGrant.request`, then the browser to auth's UI. |
| `POST /oauth/token` | `token.exchange` (`authorization_code`) or `token.refresh` (`refresh_token`). |
| `POST /oauth/register` | `oauthClient.register` (RFC 7591). |
| `POST /oauth/revoke` | `token.revoke` (RFC 7009). |
| `GET /api/authorizations/:id`, `POST …/approve`, `POST …/deny` | For auth's UI: the request and the person's answer. |

The endpoints an MCP client calls itself are open to any origin (CORS): some
clients, such as the MCP inspector, run in a browser. `/oauth/authorize` is not: the
browser goes to it.

Like every route in newt, these only translate HTTP into a use case call and back:

```ts
// cooper/backend/contexts/auth/modules/token/token.routes.ts
base.oauth.post('/token', async request => {
  try {
    const { field, clientId, clientSecret } = await formOf(request)
    const grantType = field('grant_type')
    const pair = grantType === 'authorization_code'
      ? await tokens.exchange({ clientId, clientSecret, code: field('code') ?? '', codeVerifier: field('code_verifier') ?? '', redirectUri: field('redirect_uri') ?? '' })
      : grantType === 'refresh_token'
        ? await tokens.refresh({ clientId, clientSecret, refreshToken: field('refresh_token') ?? '' })
        : null
    if (!pair) return Response.json({ error: 'unsupported_grant_type', error_description: 'cooper gives tokens for a code or a refresh token' }, { status: 400, headers: NO_STORE })
    return Response.json({ access_token: pair.accessToken, token_type: 'Bearer', expires_in: pair.expiresIn, refresh_token: pair.refreshToken }, { headers: NO_STORE })
  } catch (error) {
    return toOauthErrorResponse(error, 'invalid_request', OAUTH_ERRORS)
  }
}, { public: true })
```

## Errors in OAuth's format

Domain errors stay domain errors: `InvalidClient` is an `UnauthorizedError`,
`InvalidGrant` a `ValidationError`, each with its code. The API would answer them as
`{ error, code }`. An OAuth client expects `{ error, error_description }`
(RFC 6749 §5.2), with OAuth's own error names. newt's `toOauthErrorResponse` does
the translation:

```ts
// packages/newt/http/to-oauth-error-response.ts
/**
 * What an OAuth client receives when a request fails: `{ error, error_description }`
 * (RFC 6749 §5.2), not the API's `{ error, code }`. `codes` names the OAuth error of each
 * domain error code; anything else that is the request's fault is `fallback`.
 */
export function toOauthErrorResponse(error: unknown, fallback: string, codes: Record<string, string> = {}): Response {
```

The route gives it the map from domain codes to OAuth names:

```ts
// cooper/backend/contexts/auth/modules/token/token.routes.ts
/** The OAuth error of each of the errors these endpoints may meet. */
const OAUTH_ERRORS = {
  'oauthClient.invalid_client': 'invalid_client',
  'oauthGrant.invalid_grant': 'invalid_grant',
  'token.invalid_grant': 'invalid_grant',
}
```

The status comes from the domain error (401 for `invalid_client`, 400 for
`invalid_grant`). Anything unexpected is a 500 `server_error`, and is logged.

`/oauth/authorize` is different: it answers a browser, not a client. A request auth
can't answer is never sent back to an address nobody vouched for. The browser goes
to auth's error page instead.

## The web session: each app is a confidential client

boards and the backoffice sign their people in through auth, and both do it the same
way. The shared part is a module in `cooper/backend/shared/web-session`. The app's
**server** does the OAuth (a backend for its frontend): the browser only ever holds
the app's own session cookie, never a token.

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
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
```

It registers four routes and the router's authenticator:

- `GET /api/session/sign-in?returnTo=/path`: a state and a PKCE verifier in a short
  cookie, and the browser to auth's `/oauth/authorize`.
- `GET /api/session/callback`: auth sends the browser back with a code. The server
  trades it at auth's `/oauth/token`, over real HTTP, with its secret.
- `GET /api/session`: the signed-in person. `POST /api/session/sign-out` ends it.

The callback is where it all comes together:

```ts
// cooper/backend/shared/web-session/web-session.module.ts
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
```

Notice:

- **The code is traded over HTTP**, as any OAuth client would. Asking who the token
  is for is an **in-process call** (`identify`, auth's `token.verify`): both
  contexts run in the same process.
- **The app keeps no token.** Who signed in is all it needed. It gives the tokens
  back and opens its own session, in its own store (the module brings its own
  migration, which each context copies into its migrations).
- **`retryOnConflict: false`**: it called auth before saving. Running it again would
  present a spent code.

## How to check it

auth's OAuth test drives the whole flow over HTTP, as an MCP client would:

```ts
// cooper/backend/contexts/auth/oauth.test.ts
const traded = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK })
expect(traded.status).toBe(200)
const first = (await traded.json()) as { access_token: string, refresh_token: string, token_type: string, expires_in: number }
expect(first).toMatchObject({ token_type: 'Bearer', expires_in: config.auth.oauth.accessMinutes * 60 })
expect(await auth.modules.token.verify(first.access_token)).toMatchObject({ userId: ana.id, clientId, productId: 'cooper', resource: MCP })

// A refresh replaces both tokens.
const refreshed = (await (await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId })).json()) as { access_token: string, refresh_token: string }
expect(await auth.modules.token.verify(first.access_token)).toBeNull()
```

A code traded twice fails in OAuth's format, and a worker revokes the first tokens:

```ts
// cooper/backend/contexts/auth/oauth.test.ts
const first = (await (await exchange()).json()) as { access_token: string }
const again = await exchange()
expect(again.status).toBe(400)
expect(await again.json()).toMatchObject({ error: 'invalid_grant' })
await auth.base.jobs.idle()
expect(await auth.modules.token.verify(first.access_token)).toBeNull()
```

```bash
bun test cooper/backend/contexts/auth
```

With cooper running (`bun run cooper`), ask auth where everything is:

```bash
curl http://localhost:3001/.well-known/oauth-authorization-server
```

```json
{
  "issuer": "http://localhost:5171",
  "authorization_endpoint": "http://localhost:5171/oauth/authorize",
  "token_endpoint": "http://localhost:5171/oauth/token",
  "registration_endpoint": "http://localhost:5171/oauth/register",
  "revocation_endpoint": "http://localhost:5171/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "revocation_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"]
}
```

The addresses are auth's public URL, its UI's server in development, which passes
`/oauth` and `/.well-known` on to port 3001.

## In short

- An OAuth server is **modules like any other**: clients, grants and tokens, with
  their entities, use cases, events and workers.
- What is part of the system, such as the **products**, is declared in code, not
  stored.
- **Secrets, codes and tokens are kept as hashes.** Compare them in constant time.
- OAuth's endpoints live on **their own router**, outside `/api`, and answer errors
  with **`toOauthErrorResponse`**: domain errors in, `{ error, error_description }` out.
- Every context asks auth **`token.verify`** who a token is for, in-process.
- Each app is a **confidential client** whose server does the OAuth. The browser
  holds the app's session cookie, never a token.
