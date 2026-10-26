# An OAuth server

auth signs people in, but only to auth itself: its session is a cookie on auth's
origin, which no other app of cooper can read. boards, opened from another address,
still trusts an `x-user` header. The backoffice will need the same. And an AI
assistant that wants to use boards through MCP (chapter [24](./24-mcp-server)) has no
browser session at all: it needs a token it can send with each call, given with the
person's consent.

That is what OAuth is for. This chapter makes auth an **OAuth 2.1 server**, with the
authorization code flow and PKCE:

1. A client sends the browser to auth's `/oauth/authorize`, with where it wants the
   answer (`redirect_uri`) and the hash of a secret only it knows (`code_challenge`).
2. auth keeps the request and sends the browser on to its UI, which signs the person
   in and asks them. If they say yes, the browser goes back to the client with a
   one-time **code**.
3. The client trades that code, with the secret behind the hash (`code_verifier`), at
   `/oauth/token`, for an **access token** and a **refresh token**.
4. Any context that receives the access token asks auth whose it is: `token.verify`.

auth has two kinds of clients. Each **product** (boards, the backoffice) is a
confidential client: its web app proves itself with a secret it keeps on its server,
and it is declared in cooper's code, as the products are. Each **MCP client** (Claude,
the MCP inspector) is a public client that registers itself, and proves itself with
PKCE alone.

newt has no OAuth server, and does not need one: OAuth is a protocol, and its code is
cooper's. What newt gives is the HTTP around it, and that is what this chapter teaches
in full: a second router at the root, an error format of OAuth's own, routes that
pages of other origins may call, and a way to serve both routers on one port. The
modules beside them hold secrets, write to each other once, and revoke what was copied
from a worker: all newt you have met, used in a new place. The protocol code itself
(three modules, about 1,300 lines) you copy from the repository, and this chapter walks
through its shape.

There is no UI yet. auth's pages, `/authorize/:id` and `/error`, come with the
frontends in chapter [23](./23-frontends); here you play them with `curl`. boards
becomes a client of auth in chapter [22](./22-web-session).

At the end you will have these files:

```
cooper/backend/
  config.ts                         changed: auth's public URL, client secrets, token lifetimes
  shared/cors.ts                    who may call from another origin
  shared/served-context.ts          changed: routes()
  shared/web-session/web-session.schema.ts   where codes arrive
  contexts/auth/
    auth-base.ts                    changed: the oauth router
    auth.context.ts                 changed: serves it, declares the products' clients
    initialize-modules.ts           changed: three modules, each product's client
    oauth-server-metadata.ts        /.well-known/oauth-authorization-server
    oauth.test.ts                   copied
    migrations/sqlite/              copied
      00007_oauth-client_{up,down}.sql
      00008_oauth-grant_{up,down}.sql
      00009_token_{up,down}.sql
    modules/
      product/   product.schema.ts  product.module.ts   changed
      session/   session.module.ts  session.routes.ts   changed: signing out from an app
      oauth-client/   copied
      oauth-grant/    copied
      token/          copied
```

## Its settings

auth needs three new things to know: where it is opened (the address it names in
every link it gives clients), the secret of each product's client, and how long tokens
last. In `config.ts`, add auth's public URL to `publicUrls`, the secrets after it:

```ts
// cooper/backend/config.ts
const publicUrls = {
  auth: env.COOPER_AUTH_PUBLIC_URL ?? 'http://localhost:5171',
  boards: env.COOPER_BOARDS_PUBLIC_URL ?? 'http://localhost:5172',
  backoffice: env.COOPER_BACKOFFICE_PUBLIC_URL ?? 'http://localhost:5173',
}

/**
 * `COOPER_<APP>_CLIENT_SECRET`: the secret each web app proves itself with at auth's
 * token endpoint, as an OAuth confidential client. `auth` knows both; each app its own.
 */
const clientSecrets = {
  cooper: env.COOPER_BOARDS_CLIENT_SECRET ?? 'cooper-dev-boards-client-secret',
  backoffice: env.COOPER_BACKOFFICE_CLIENT_SECRET ?? 'cooper-dev-backoffice-client-secret',
}
```

and auth's part becomes:

```ts
// cooper/backend/config.ts
  /** Who someone is: accounts, workspaces, who may enter what, and the OAuth server every app signs in with. */
  auth: {
    /** `COOPER_AUTH_PORT`: where it listens. */
    port: Number(env.COOPER_AUTH_PORT ?? 3001),
    /** `COOPER_AUTH_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_AUTH_DATABASE ?? 'data/cooper-auth.db'),
    publicUrl: publicUrls.auth,
    /** Where the other contexts are opened: the apps that sign people in through it. */
    boardsPublicUrl: publicUrls.boards,
    backofficePublicUrl: publicUrls.backoffice,
    /** The secret of each app's OAuth client, by the product it signs people in to. */
    clientSecrets,
    sessionDays,
    /** `COOPER_INVITATION_DAYS`: how long an invitation to a workspace waits to be accepted. */
    invitationDays: Number(env.COOPER_INVITATION_DAYS ?? 7),
    oauth: {
      /** `COOPER_OAUTH_ACCESS_MINUTES`: how long an access token lasts; the client refreshes it after. */
      accessMinutes: Number(env.COOPER_OAUTH_ACCESS_MINUTES ?? 60),
      /** `COOPER_OAUTH_REFRESH_DAYS`: how long a refresh token lasts unused. */
      refreshDays: Number(env.COOPER_OAUTH_REFRESH_DAYS ?? 30),
    },
  },
```

auth's public URL is not its port. In development, 5171 is auth's frontend (chapter
23), whose dev server forwards `/api`, `/oauth` and `/.well-known` to 3001: the
browser sees one origin for auth's pages and its endpoints, so auth's cookie is sent to
both. In production it is auth's own domain. The secrets have development defaults;
production sets them, and each app knows only its own. The `cooper` key is boards'
product id, so its variable is `COOPER_BOARDS_CLIENT_SECRET`.

## A second router, at the root

auth's API lives under `/api`, answers `{ error, code }`, and every route needs a
session unless it says otherwise. OAuth's endpoints are different in all three ways.
Their addresses are fixed by the protocol and its clients (`/oauth/token`,
`/.well-known/oauth-authorization-server`), not under `/api`. They answer errors in
OAuth's own format, `{ error, error_description }`. And none of them needs a session:
a client proves itself on its own, with a secret or a PKCE verifier, and the browser
that arrives at `/oauth/authorize` may not be signed in yet.

So they get a router of their own. auth's base gains it:

```ts
// cooper/backend/contexts/auth/auth-base.ts
import { HttpRouter } from 'newt/http'
import { CooperBase } from '../../shared/cooper-base'

/**
 * What `auth`'s modules receive: cooper's base, and a second router at the root for
 * OAuth's addresses (`/oauth/authorize`, `/oauth/token`, `/.well-known/…`). They are
 * not its API's: outside `/api`, public (the client proves itself on its own), and
 * with OAuth's own wire format (a form in, `{ error, error_description }` out, each
 * route's `onError`). The context serves them beside its API (`routes()`).
 */
export class AuthBase extends CooperBase {
  readonly oauth = new HttpRouter({ prefix: '', public: true })
}
```

**`new HttpRouter({ prefix: '', public: true })`.** A router's options are the
defaults of each of its routes, plus where they go:

- **`prefix: ''`** mounts it at the root. A router under `/api` answers a 404 for any
  path under `/api` it has no route for; one at the root takes only the paths it has
  routes for, and leaves every other address to whatever comes after it (the frontend,
  in chapter 23). So `/oauth/token` is this router's, and `/authorize/123` is not.
- **`public: true`** is each route's `{ public: true }`, said once: none of these
  routes asks the authenticator who is calling, and none runs as an actor. A route that
  needs to know who is signed in to auth reads the cookie itself, as you will see.

Each route may still say otherwise for itself: a route's own options come first.

The router is on the base because the modules register their routes there, as they do
on `base.http`: the OAuth modules each add theirs to `base.oauth`.

## Serving both: `routes()`

`serve` takes one router, the context's API. Anything else goes in its `routes`
option, as `Bun.serve` takes routes: another router's `routes()`, a webhook. Every
served context of cooper gets a place to add them, `routes()`, empty unless it says
otherwise:

```ts
// cooper/backend/shared/served-context.ts
import { BoundedContext } from 'newt/runtime'
import type { ServeOptions } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain. It answers `GET /api/health` without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** What its server answers besides its modules' API: OAuth's endpoints, an MCP entry. */
  protected routes(): Bun.Serve.Routes<undefined, string> {
    return {}
  }

  /** How it is served (`runContexts`, `serve`): its modules' API, what it adds and its health. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, routes: this.routes(), health: true }
  }
}
```

auth overrides it below. boards will too, for its MCP entry, in chapter 24.

## Open to other origins: `cors`

An MCP client may run in a browser: the MCP inspector is a web page on its own origin.
It reads auth's metadata, registers, and trades its code from there. A browser lets a
page call another origin only if that origin says so (CORS). newt's routes say it with
the `cors` option, which is one value cooper keeps in one place:

```ts
// cooper/backend/shared/cors.ts
import type { Cors } from 'newt/http'

/**
 * What a page of another origin may send and read: the MCP inspector, for one, runs
 * in a browser, and finds out how to sign in, registers, trades its code and calls
 * the MCP server from there. Never with cookies: who it is goes in its bearer token,
 * so any origin may ask.
 */
export const OPEN_TO_BROWSERS: Cors = {
  origin: '*',
  headers: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'],
  expose: ['mcp-session-id', 'www-authenticate'],
}
```

`Cors` is newt's type. `origin` is `'*'` or a list of origins; `headers` are what the
page may send besides the simple ones; `expose` what it may read of the answer
besides the simple ones. A route with `cors` answers the browser's preflight
(`OPTIONS`) itself, and adds the headers to every answer, its errors included. A
`maxAge` would say how long the browser keeps the preflight's answer; a day unless
told.

It is never with cookies: newt does not send `Access-Control-Allow-Credentials`. That
is why `'*'` is safe here. A page of another origin cannot ride on someone's auth
cookie; who it is travels in a bearer token, which it must have been given. The MCP
headers are in the list because boards' MCP server uses the same value in chapter 24.

## Where everything is: the metadata

A client that knows only where auth is finds the rest in one document (RFC 8414):

```ts
// cooper/backend/contexts/auth/oauth-server-metadata.ts
import type { HttpRouter } from 'newt/http'
import { OPEN_TO_BROWSERS } from '../../shared/cors'

/**
 * How a client that only knows where auth is finds out the rest (RFC 8414): where to
 * send the person, get tokens, register and give tokens back. boards names auth in
 * its MCP server's own metadata (RFC 9728), and an MCP client follows it here.
 */
export function registerOauthServerMetadata(oauth: HttpRouter, publicUrl: string): void {
  const metadata = {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    revocation_endpoint: `${publicUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // A product's web app proves itself with its secret; an MCP client is public, with PKCE.
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  }
  // Read by clients in a browser too, such as the MCP inspector.
  oauth.get('/.well-known/oauth-authorization-server', () => Response.json(metadata), { cors: OPEN_TO_BROWSERS })
}
```

The first route on `base.oauth`. It is public (the router says so) and open to any
origin (`cors`). The addresses are `publicUrl`'s, the address clients reach auth at,
never the port it listens on.

## Products become clients

Each product is an OAuth client whose `client_id` is the product's id. auth needs to
know, for each one, who may enter it, whether it has an MCP server, and where its codes
go. `product.schema.ts` gains a schema for the first and three fields:

```ts
// cooper/backend/contexts/auth/modules/product/product.schema.ts
/** Who may enter a product: anyone with an account, or only those given access to it. */
export const ProductAccessSchema = z.enum(['anyone', 'granted'])

/**
 * An app of cooper that signs people in through auth, as cooper's code declares it:
 * `cooper` (the boards) and `backoffice` (the staff's console). Each one is an OAuth
 * confidential client of auth, whose `client_id` is the product's id.
 */
export const ProductSchema = z.object({
  /** Its name in cooper's code, and its OAuth client_id. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
// …
  signUp: z.boolean(),
  access: ProductAccessSchema,
  /** Its MCP server, if it has one: the resource (RFC 8707) the tokens of MCP clients are for. */
  mcpResource: z.url().nullable(),
  /** Where its OAuth client receives the codes it signs people in with. */
  redirectUri: z.url(),
})

export type ProductAccess = z.infer<typeof ProductAccessSchema>
export type ProductDTO = z.infer<typeof ProductSchema>
```

- **`access`**: `anyone` lets in anyone with an account (boards: what they see inside
  is up to the workspaces); `granted` only those given an access to the whole product
  (the backoffice: the staff).
- **`mcpResource`**: the address of the product's MCP server, which the tokens of MCP
  clients are for (RFC 8707's `resource`). boards has one; the backoffice does not.
- **`redirectUri`**: where the product's web app receives its codes.

Every web app receives them at the same path, which the web-session helper of chapter
22 serves. It starts here with that one constant:

```ts
// cooper/backend/shared/web-session/web-session.schema.ts
/**
 * Where auth sends the browser back with a code: every web app's OAuth redirect URI
 * is its public URL and this path. auth declares each product's client with it.
 */
export const WEB_SESSION_CALLBACK = '/api/session/callback'
```

The product module gains two use cases. `list`, after the constructor, gives every
product, for the OAuth client module and for signing out; `get`'s comment now names
the web-session helper:

```ts
// cooper/backend/contexts/auth/modules/product/product.module.ts
  @UseCase()
  async list(): Promise<ProductDTO[]> {
    return structuredClone(this.products)
  }

  /** For the web-session helper and other contexts: a product by its id. */
```

and `forResource`, at the end, the product an MCP client asks for:

```ts
// cooper/backend/contexts/auth/modules/product/product.module.ts
/** The same address, written either way: with or without the last slash. */
const sameResource = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
// …
  /**
   * The product whose MCP server is this resource, or, when an MCP client names none,
   * the only one with an MCP server. Null when none is.
   */
  @UseCase()
  async forResource(resource: string | undefined): Promise<ProductDTO | null> {
    const withMcp = this.products.filter(product => product.mcpResource !== null)
    const product = resource === undefined
      ? (withMcp.length === 1 ? withMcp[0] : undefined)
      : withMcp.find(each => sameResource(each.mcpResource!, resource))
    return product ? structuredClone(product) : null
  }
```

`sameResource` goes above the class, after the imports.

## The protocol: copy it

Three modules and their tables are OAuth itself: clients, authorization requests and
tokens. Copy them, with their test, from the chapter's tag:

```sh
git checkout tutorial/21 -- \
  cooper/backend/contexts/auth/modules/oauth-client \
  cooper/backend/contexts/auth/modules/oauth-grant \
  cooper/backend/contexts/auth/modules/token \
  'cooper/backend/contexts/auth/migrations/sqlite/0000[789]_*' \
  cooper/backend/contexts/auth/oauth.test.ts
```

Each module has the anatomy of chapter [2](./02-first-module): a schema, an entity, a
repository over one table, errors, a module of use cases and a routes file. What is
OAuth in them (which fields a request must have, PKCE's hash, which RFC says what) you
can read at your pace. What follows is the part that is newt.

| Module | What it keeps | Its routes |
|---|---|---|
| `oauthClient` | `oauth_client`: each product's client, and each MCP client that registered | `POST /oauth/register` |
| `oauthGrant` | `oauth_grant`: an authorization request, the person's answer, its code's hash | `GET /oauth/authorize`, `GET /api/authorizations/:id`, `POST …/approve`, `POST …/deny` |
| `token` | `token`: the access and refresh tokens a grant was traded for, as hashes | `POST /oauth/token`, `POST /oauth/revoke` |

### Secrets never leave: a public schema

Chapter [17](./17-auth) gave the user entity a public schema, so that its password's
hash never reaches an answer or an event. Each of these entities holds a secret too,
and does the same. A product's client keeps its secret's hash:

```ts
// cooper/backend/contexts/auth/modules/oauth-client/oauth-client.ts
/** The client as it is kept: what anyone sees, and its secret's hash when it has one. */
const OauthClientEntitySchema = OauthClientSchema.extend({
  /** A confidential client's secret, hashed; null for a public one, which only has PKCE. */
  secretHash: z.string().nullable(),
})
// …
export class OauthClient extends Entity<typeof OauthClientEntitySchema, typeof OauthClientSchema> {

  private constructor(input: EntityInput<OauthClientEntityDTO>, isNew: boolean) {
    super(OauthClientEntitySchema, input, isNew, OauthClientSchema)
  }
```

a grant, its code's:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.ts
/** The request as it is kept: what anyone sees, and the hash of the code it gave. */
const OauthGrantEntitySchema = OauthGrantSchema.extend({
  codeHash: z.string().nullable(),
})
```

and a token, its tokens':

```ts
// cooper/backend/contexts/auth/modules/token/token.ts
/** The tokens as they are kept: what anyone sees, and their hashes. */
const TokenEntitySchema = TokenSchema.extend({
  accessTokenHash: z.string().min(1),
  refreshTokenHash: z.string().min(1),
  /** The refresh token this one replaced: brought again, it was copied. */
  previousRefreshTokenHash: z.string().nullable(),
})
```

Each passes its public schema last to `super`, so `toDTO()` gives only what anyone may
see, and the repository stores the rest. The secrets themselves are kept nowhere. A
code or a token is made with `SecretToken.generate()`, given once (in the redirect, in
the token endpoint's answer), and only `SecretToken.hash` of it is stored, as chapter
17's sessions were. Each kind has a prefix (`cooper_ac_`, `cooper_at_`, `cooper_rt_`)
so that people and secret scanners recognize one. A client secret is a value object,
`ClientSecret`, compared in constant time.

### OAuth's errors: `onError` and `toOauthErrorResponse`

A route of `base.http` that throws answers `{ error, code }`, through `toErrorResponse`
(chapter [3](./03-pages-and-errors)). An OAuth client expects `{ error,
error_description }`, with `error` one of the protocol's codes. Any route, group or
router may say how its errors are answered, with `onError`; newt has the OAuth one,
`toOauthErrorResponse(error, fallback, codes)`. Registration uses it:

```ts
// cooper/backend/contexts/auth/modules/oauth-client/oauth-client.routes.ts
import { toOauthErrorResponse } from 'newt/http'
import { OPEN_TO_BROWSERS } from '../../../../shared/cors'
import type { AuthBase } from '../../auth-base'
import type { OauthClient_Module } from './oauth-client.module'

/** What RFC 7591 calls the fields this route reads. */
type RegistrationRequest = { client_name?: unknown, redirect_uris?: unknown, token_endpoint_auth_method?: unknown }

export function registerOauthClientRoutes(base: AuthBase, clients: OauthClient_Module): void {
  // Dynamic client registration (RFC 7591), for MCP clients. Public: whoever registers
  // is nobody in cooper yet. It speaks OAuth's wire format, errors included.
  base.oauth.post('/oauth/register', async request => {
    const body = (await request.json()) as RegistrationRequest
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
      return Response.json({ error: 'invalid_client_metadata', error_description: 'A registered client is public: its token_endpoint_auth_method is none' }, { status: 400, headers: { 'cache-control': 'no-store' } })
    }
    const client = await clients.register({
      name: typeof body.client_name === 'string' ? body.client_name : undefined,
      redirectUris: body.redirect_uris as string[],
    })
    return Response.json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      // Whatever the client asked for, this is what it is registered with.
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, { status: 201, headers: { 'cache-control': 'no-store' } })
  }, { cors: OPEN_TO_BROWSERS, onError: error => toOauthErrorResponse(error, 'invalid_client_metadata') })
}
```

- The route reads the body raw (`request.json()`), in RFC 7591's snake_case, and
  passes the use case cooper's names. What is wrong with them, a redirect address on
  another site say, the use case's schema finds.
- **`onError`** gets every error the route throws. `toOauthErrorResponse` answers a
  `DomainError` with its own status and message, a zod error or a body that is not
  JSON with a 400; each with `error` set to `fallback`, here `invalid_client_metadata`,
  unless `codes` names another for that error's code. Anything else is a 500,
  `server_error`, logged, saying nothing of the inside. Every answer has `cache-control:
  no-store`, as OAuth asks.
- **`cors`** on the route lets the MCP inspector register from its page.

The token endpoint has more errors to tell apart, so it maps them. Both of its routes
share their options, a `RouteOptions` value:

```ts
// cooper/backend/contexts/auth/modules/token/token.routes.ts
import type { BunRequest } from 'bun'
import { toOauthErrorResponse, type RouteOptions } from 'newt/http'
import { OPEN_TO_BROWSERS } from '../../../../shared/cors'
import type { AuthBase } from '../../auth-base'
import type { Token_Module } from './token.module'

/** The OAuth error of each of the errors these endpoints may meet. */
const OAUTH_ERRORS = {
  'oauthClient.invalid_client': 'invalid_client',
  'oauthGrant.invalid_grant': 'invalid_grant',
  'token.invalid_grant': 'invalid_grant',
}

const NO_STORE = { 'cache-control': 'no-store' }

/** Open to clients in a browser, and failing in OAuth's wire format. */
const TOKEN_ENDPOINT: RouteOptions = {
  cors: OPEN_TO_BROWSERS,
  onError: error => toOauthErrorResponse(error, 'invalid_request', OAUTH_ERRORS),
}

/**
 * A request to the token endpoints: a form (RFC 6749 §3.2), and the client's
 * credentials in its `Authorization` header (`client_secret_basic`) or in the form
 * (`client_secret_post`, or a public client's bare `client_id`).
 */
async function formOf(request: BunRequest) {
  const form = new URLSearchParams(await request.text())
  const field = (name: string) => form.get(name) ?? undefined
  const basic = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1]
  if (!basic) return { field, clientId: field('client_id') ?? '', clientSecret: field('client_secret') }
  const [id = '', secret = ''] = Buffer.from(basic, 'base64').toString().split(':')
  return { field, clientId: decodeURIComponent(id), clientSecret: decodeURIComponent(secret) }
}

export function registerTokenRoutes(base: AuthBase, tokens: Token_Module): void {
  // The token endpoint (RFC 6749 §3.2). Public: the client proves itself with its
  // secret or its PKCE verifier. OAuth's wire format, errors included.
  base.oauth.post('/oauth/token', async request => {
    const { field, clientId, clientSecret } = await formOf(request)
    const grantType = field('grant_type')
    const pair = grantType === 'authorization_code'
      ? await tokens.exchange({ clientId, clientSecret, code: field('code') ?? '', codeVerifier: field('code_verifier') ?? '', redirectUri: field('redirect_uri') ?? '' })
      : grantType === 'refresh_token'
        ? await tokens.refresh({ clientId, clientSecret, refreshToken: field('refresh_token') ?? '' })
        : null
    if (!pair) return Response.json({ error: 'unsupported_grant_type', error_description: 'cooper gives tokens for a code or a refresh token' }, { status: 400, headers: NO_STORE })
    return Response.json({ access_token: pair.accessToken, token_type: 'Bearer', expires_in: pair.expiresIn, refresh_token: pair.refreshToken }, { headers: NO_STORE })
  }, TOKEN_ENDPOINT)

  // Token revocation (RFC 7009): a 200 whether the token was one or not.
  base.oauth.post('/oauth/revoke', async request => {
    const { field, clientId, clientSecret } = await formOf(request)
    await tokens.revoke({ clientId, clientSecret, token: field('token') ?? '' })
    return new Response(null, { status: 200, headers: NO_STORE })
  }, TOKEN_ENDPOINT)
}
```

`OAUTH_ERRORS` maps cooper's error codes to OAuth's: an unknown client or a wrong
secret is `invalid_client` (with `InvalidClient`'s 401), a code or refresh token that
is no good is `invalid_grant`. Whatever else is the request's fault is
`invalid_request`. The form is read raw too (`request.text()`): OAuth sends
`application/x-www-form-urlencoded`, and the client's credentials may come in the
`Authorization` header.

`onError` decides the body of every error a route throws. It does not decide a 405:
a method a path does not have is answered by the router's own default, so `GET
/oauth/token` gets newt's `{ error, code: 'method_not_allowed' }`.

### A browser, not a client: the authorization endpoint

The authorization endpoint is the one the browser visits. Its errors are not for a
program to read: the person is looking at the screen. And a request whose client or
redirect address is wrong must never send the browser back to that address. So its
`onError` sends the browser to auth's error page instead:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.routes.ts
import { DomainError, runAsActor } from 'newt/core'
import { toErrorResponse } from 'newt/http'
import type { AuthBase } from '../../auth-base'
import { SessionCookie } from '../session/session.schema'
import type { OauthGrant_Deps } from './oauth-grant.deps'
import type { OauthGrant_Module } from './oauth-grant.module'
import type { OauthGrant_Options } from './oauth-grant-options'

export function registerOauthGrantRoutes(base: AuthBase, grants: OauthGrant_Module, deps: OauthGrant_Deps, options: OauthGrant_Options): void {
  // The authorization endpoint (RFC 6749 §3.1), where a client sends the browser. The
  // request is kept, and the browser goes on to auth's UI, which signs the person in
  // and asks them. A request auth cannot answer is shown there, never sent back to
  // an address nobody vouched for.
  base.oauth.get('/oauth/authorize', async request => {
    const query = new URL(request.url).searchParams
    const field = (name: string) => query.get(name) ?? undefined
    const { id } = await grants.request({
      responseType: field('response_type') ?? '',
      clientId: field('client_id') ?? '',
      redirectUri: field('redirect_uri') ?? '',
      codeChallenge: field('code_challenge') ?? '',
      codeChallengeMethod: field('code_challenge_method') ?? '',
      state: field('state'),
      resource: field('resource'),
    })
    return Response.redirect(`${options.publicUrl}/authorize/${id}`, 302)
  }, {
    onError: error => error instanceof DomainError
      ? Response.redirect(`${options.publicUrl}/error?${new URLSearchParams({ message: error.message })}`, 302)
      : toErrorResponse(error),
  })

  // For auth's UI: what is asked, to anyone with its address; the answer, signed in.
  // Whoever is signed in to auth already is told upfront if the product refuses them.
  base.http.get('/authorizations/:id', async request => {
    const actor = await deps.session.authenticate(request.cookies.get(SessionCookie) ?? undefined)
    const review = () => grants.review(request.params.id)
    return Response.json(await (actor ? runAsActor(actor, review) : review()))
  }, { public: true })

  base.http.post('/authorizations/:id/approve', async request => Response.json(await grants.approve(request.params.id)))

  base.http.post('/authorizations/:id/deny', async request => Response.json(await grants.deny(request.params.id)))
}
```

`onError` takes any function from the error (and the request) to a response: here a
redirect for what cooper refuses (a `DomainError`), and the API's own answer,
`toErrorResponse`, for what is a bug. No `cors`: the browser goes there itself, it is
not called from a page.

The other three routes are on `base.http`, under `/api`: they are auth's UI's, not
OAuth's. Approving and denying need a session, as any API route does.
`GET /authorizations/:id` is public, because the UI shows who is asking before the
person signs in. But if someone is signed in, it should say upfront whether the product
will let them in. A public route runs as nobody, so the route asks the session module
itself (`session.authenticate`, chapter 17's authenticator's use case) and, if the
cookie is a session, runs the use case as that actor with `runAsActor`.

### Who is signed in, if anyone: `findCurrentActor`

The use case then asks who it runs as, without requiring anyone:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.module.ts
  @UseCase()
  async review(id: string): Promise<OauthGrantReviewDTO> {
    const grant = await this.load(id)
    const client = await this.deps.oauthClient.get(grant.clientId)
    const product = await this.deps.product.get(grant.productId)
    const { id: productId, name, signUp } = product
    // Who is signed in, if anyone: a public route runs as someone only when they are.
    const userId = findCurrentActor()?.userId ?? null
    const refused = userId !== null && !(await this.mayEnter(userId, product)) ? new NoProductAccess(name) : null
```

`currentActor()` throws `NoActor`, a 401, outside any actor: right for `approve`,
which nobody may do without signing in. `findCurrentActor()` returns `undefined`
instead: for what anyone may see, and someone signed in sees more of. Use it only
there; a use case that needs someone uses `currentActor()`, and the 401 comes by
itself.

### A code is spent once: `writesTo` and `retryOnConflict`

The client trades its code at the token endpoint, which calls `token.exchange`. That
use case spends the code, in the grant module, then saves the tokens, in its own:

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
```

These are the two options of chapter [18](./18-tenants-and-access)'s `tenant.create`,
for reasons of their own:

- **`writesTo: ['oauthGrant']`.** `redeem` saves the grant, a write to another module
  outside a worker. The client is waiting for its tokens in this very answer; a worker
  would give them to nobody. If saving the tokens fails after the code is spent, the
  code is gone and the client starts again: nothing is half made that a person sees.
- **`retryOnConflict: false`.** A conflict on the token's save would run `exchange`
  again from the top, and `redeem` would find its own code spent. To the grant module
  that looks exactly like a copied code, and it would revoke what it gave. So the
  chain never runs again.

### A copied code is revoked, from a worker

A code brought a second time, after it was traded, was copied (RFC 6749 §4.1.2): the
tokens it gave must stop working. `redeem` sees it and marks the grant:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.module.ts
    const grant = codeHash ? await this.repo.first({ codeHash }) : undefined
    if (!grant) throw new InvalidGrant()
    if (grant.status === 'redeemed') {
      grant.replay()
      await this.repo.persist(grant)
      throw new InvalidGrant()
    }
```

The entity tells what happened with an event:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.ts
  replay(): void {
    this.change({ status: 'replayed' })
    this.trackEvent(new OauthGrant_Replayed(this.toDTO()))
  }
```

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/events/oauth-grant-replayed.ts
import type { DomainEvent } from 'newt/core'
import type { OauthGrantDTO } from '../oauth-grant.schema'

/** A code was brought again after it was traded: the tokens it gave are to be revoked. */
export class OauthGrant_Replayed implements DomainEvent<OauthGrantDTO> {
  static readonly eventName = 'oauthGrant.replayed'
  readonly name = OauthGrant_Replayed.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: OauthGrantDTO) {}
}
```

The tokens are the token module's, and the grant module must not write them. So the
module offers the event, as chapter [10](./10-events)'s did:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.module.ts
  readonly events

  private constructor(base: AuthBase, private readonly repo: OauthGrant_Repository, private readonly deps: OauthGrant_Deps) {
    super('oauthGrant', base.invocations)
    this.events = eventsOf(base.bus, { replayed: OauthGrant_Replayed })
  }
```

and the token module subscribes a worker to it:

```ts
// cooper/backend/contexts/auth/modules/token/token.workers.ts
import type { Token_Deps } from './token.deps'
import type { Token_Module } from './token.module'

/** A code brought twice was copied: whatever it was traded for stops working, a moment later. */
export function registerTokenWorkers(tokens: Token_Module, deps: Token_Deps): void {
  deps.oauthGrant.events.replayed.subscribe(grant => tokens.revokeGrant(grant.id), {
    strategy: 'handler',
    queue: 'token.revokeGrant.on.oauthGrant.replayed',
  })
}
```

The job is written in the same transaction as the grant's `replayed`, then
`revokeGrant` deletes the token row. It may run more than once, and finds nothing the
second time. The thrower gets its `invalid_grant` at once; the tokens stop working a
moment later. Note what does not happen: `redeem` throws after it saves. Its save is
its own, committed, and the error only tells the caller; the job is already in the
outbox.

A refresh token brought again after it was replaced is the same story inside one
module: `token.refresh` finds it as a `previousRefreshTokenHash` and revokes that row
itself.

## Signing out from an app

When someone signs out of boards (chapter 22), boards' own session ends. But auth's
session would still be there, and signing in again would not ask who it is. So an app
sends the browser to auth's `/oauth/logout` on its way out. auth ends its session, and
sends the browser back where the app asked, if that is one of cooper's products: never
to an address nobody vouched for. The session module gains `returnAddress`, after
`signOut`:

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
  /**
   * Where the browser goes back to once signed out: the address asked for, if it is
   * on a product's own origin; auth's start (`/`) otherwise, never an address nobody
   * vouched for.
   */
  @UseCase()
  async returnAddress(redirect: string | undefined): Promise<string> {
    const url = URL.parse(redirect ?? '')
    if (!url) return '/'
    const origins = (await this.deps.product.list()).map(product => new URL(product.publicUrl).origin)
    return origins.includes(url.origin) ? url.toString() : '/'
  }
```

and its routes file one route, at the end, on the oauth router:

```ts
// cooper/backend/contexts/auth/modules/session/session.routes.ts
  base.http.get('/session', async () => Response.json(await sessions.me()))

  // Where an app sends the browser once it signed someone out of itself: auth's session
  // ends too, so signing in again asks who it is. The browser goes back to `redirect`
  // if it is an address of one of cooper's products, to auth's start otherwise.
  base.oauth.get('/oauth/logout', async request => {
    await sessions.signOut(request.cookies.get(SessionCookie) ?? undefined)
    request.cookies.delete({ name: SessionCookie, path: '/' })
    const location = await sessions.returnAddress(new URL(request.url).searchParams.get('redirect') ?? undefined)
    return new Response(null, { status: 302, headers: { location } })
  })
}
```

Update the module's comment too:

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
/**
 * Who is signed in to auth itself: signing up, in and out, and who sends each request
 * to auth's API. One session here signs the person in to every product: each product
 * opens a session of its own from it, through OAuth.
 */
```

## Wiring it

The three modules go after those they use. Each product's entry in `declaredProducts`
gains its access, its MCP server and where its codes arrive:

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import { WEB_SESSION_CALLBACK } from '../../shared/web-session/web-session.schema'
import type { Auth_Config } from './auth-config'
import type { AuthBase } from './auth-base'
import { Access_Module } from './modules/access/access.module'
import { Invitation_Module } from './modules/invitation/invitation.module'
import { OauthClient_Module } from './modules/oauth-client/oauth-client.module'
import { OauthGrant_Module } from './modules/oauth-grant/oauth-grant.module'
import { Product_Module } from './modules/product/product.module'
import { PRODUCTS, WORKSPACES_PRODUCT, type ProductDTO } from './modules/product/product.schema'
import { Session_Module } from './modules/session/session.module'
import { Tenant_Module } from './modules/tenant/tenant.module'
import { Token_Module } from './modules/token/token.module'
import { User_Module } from './modules/user/user.module'
// …
/**
 * cooper's products, declared here: the apps that sign people in through auth, each
 * with its OAuth client, whose codes arrive at the web-session helper's callback.
 */
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
      id: PRODUCTS.backoffice,
      name: 'Cooper Backoffice',
      publicUrl: config.backofficePublicUrl,
      signUp: false,
      access: 'granted',
      mcpResource: null,
      redirectUri: `${config.backofficePublicUrl}${WEB_SESSION_CALLBACK}`,
    },
  ]
}
// …
  const oauthClient = OauthClient_Module.initialize(base, { product }, { secrets: config.clientSecrets })
  const oauthGrant = OauthGrant_Module.initialize(base, { oauthClient, product, access, session }, { publicUrl: config.publicUrl })
  const token = Token_Module.initialize(base, { oauthClient, oauthGrant }, config.oauth)
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { product, user, session, access, tenant, invitation, oauthClient, oauthGrant, token, outbox }
}
```

The grant module gets `publicUrl` to send the browser to auth's pages; the token
module its lifetimes, `config.oauth` as it is.

The context registers the metadata, keeps each product's client in step with the code
and the configuration, and serves the oauth router beside its API:

```ts
// cooper/backend/contexts/auth/auth.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
import { ServedContext } from '../../shared/served-context'
import { AuthBase } from './auth-base'
import type { Auth_Config } from './auth-config'
import { initializeModules, type Auth_ModuleDeps, type Auth_Modules } from './initialize-modules'
import { registerOauthServerMetadata } from './oauth-server-metadata'

/**
 * Who someone is: accounts, workspaces (tenants), who may enter which app, and the
 * OAuth server every app of cooper, and any MCP client, signs people in with. It uses
 * no other context.
 */
export class Auth_Context extends ServedContext {

  private constructor(private readonly auth: AuthBase, readonly modules: Auth_Modules, readonly config: Auth_Config) {
    super('auth', auth, config)
  }

  /**
   * Opening it brings its database up to date before any module reads it, and the
   * OAuth clients of the products in step with cooper's code and configuration. The
   * real time tells its sessions, tokens and invitations when they expire, unless a
   * test gives it a `clock` of its own.
   */
  static async open(config: Auth_Config, deps: Auth_ModuleDeps, clock?: Clock): Promise<Auth_Context> {
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new AuthBase({ name: 'auth', store, clock })
    const modules = initializeModules(base, config, deps)
    registerOauthServerMetadata(base.oauth, config.publicUrl)
    await modules.oauthClient.declareProducts()
    return new Auth_Context(base, modules, config)
  }

  /**
   * OAuth's own addresses, beside the API: its endpoints and the server's metadata.
   * What an MCP client calls itself (the metadata, registering, the token endpoint) is
   * open to pages of any origin (`cors`): some clients, such as the MCP inspector, run
   * in a browser. The authorization endpoint is not: the browser goes to it.
   */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...this.auth.oauth.routes() }
  }
}
```

- **`declareProducts`** is a use case of the client module, run on every start. The
  first time, it makes each product's client; after that, it updates its name,
  redirect address and secret's hash from what the code and the configuration say now.
  A changed secret in production takes effect on the next start. Products are code
  (chapter 17); their clients are rows only because MCP clients' are, and the token
  endpoint finds both the same way.
- **`routes()`** is the override: the API's routes, from `super`, and the oauth
  router's. `serve` puts them in one table for `Bun.serve`. The constructor now keeps
  the base (`private readonly auth`) to reach `auth.oauth`.

## Its tests

The test you copied, `oauth.test.ts`, starts auth on a free port and drives it over
HTTP, as a client and a browser would:

```ts
// cooper/backend/contexts/auth/oauth.test.ts
beforeEach(async () => {
  const port = freePort()
  url = `http://localhost:${port}`
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port, publicUrl: url }, { mailer: { send: async () => {} } })
  server = serve(auth.serving())
  auth.start()
})
```

`freePort` and `browser` come from `newt/testing`: a port nobody listens on, and a
`fetch` that keeps cookies between calls and does not follow redirects, so a test can
sign in, then look at where auth sends it. Chapter 22 uses them for boards' web
session and says more. The test's `publicUrl` is the server itself, so the addresses
in the metadata and the redirects point at it.

Its eight tests cover the metadata; a full round (register, authorize, review before
signing in, sign up, approve, trade, verify, refresh, revoke); a replayed refresh
token; a replayed code, whose tokens are revoked after `auth.base.jobs.idle()` runs the
worker; a wrong PKCE verifier, an unknown grant type, an unknown client and a plain
challenge, which go to the error page; a person who says no; signing out on the way
back to a product and to no other address; and the backoffice's confidential client,
which lets in only staff given access and refuses a wrong secret.

## Check it

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

```text
 98 pass
 0 fail
```

The OAuth tests on their own:

```sh
bun test cooper/backend/contexts/auth/oauth.test.ts
```

```text
 8 pass
 0 fail
 60 expect() calls
Ran 8 tests across 1 file.
```

Then by hand. Start the backend (`bun cooper/backend/index.ts`). auth applies its three
new migrations, and declares the two products' clients. From another terminal, ask for
the metadata:

```sh
curl -s localhost:3001/.well-known/oauth-authorization-server
```

```text
{"issuer":"http://localhost:5171","authorization_endpoint":"http://localhost:5171/oauth/authorize","token_endpoint":"http://localhost:5171/oauth/token","registration_endpoint":"http://localhost:5171/oauth/register","revocation_endpoint":"http://localhost:5171/oauth/revoke","response_types_supported":["code"],"grant_types_supported":["authorization_code","refresh_token"],"code_challenge_methods_supported":["S256"],"token_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none"],"revocation_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none"]}
```

Every address is auth's public URL, 5171, not the port you asked. Ask as the MCP
inspector's page would before registering, with a preflight from another origin:

```sh
curl -si -X OPTIONS localhost:3001/oauth/register -H 'origin: http://localhost:6274' \
  -H 'access-control-request-method: POST' -H 'access-control-request-headers: content-type'
```

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id
Access-Control-Max-Age: 86400
…
```

Register a client:

```sh
curl -s -X POST localhost:3001/oauth/register -H 'content-type: application/json' \
  -d '{"client_name":"My MCP client","redirect_uris":["http://localhost:9999/cb"]}'
```

```text
{"client_id":"01a17968-6d36-767e-b5e4-3d4def06dbed","client_id_issued_at":1793038249,"client_name":"My MCP client","redirect_uris":["http://localhost:9999/cb"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}
```

and one that would get its codes on another site, in OAuth's format:

```sh
curl -s -X POST localhost:3001/oauth/register -H 'content-type: application/json' \
  -d '{"redirect_uris":["http://evil.example/cb"]}'
```

```text
{"error":"invalid_client_metadata","error_description":"A redirect address is https, or http on localhost"}
```

Now be the client. Keep its id, and make a PKCE pair: a random verifier, and the
base64url of its SHA-256:

```sh
CID=01a17968-6d36-767e-b5e4-3d4def06dbed   # yours
VERIFIER=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')
curl -si "localhost:3001/oauth/authorize?response_type=code&client_id=$CID&redirect_uri=http://localhost:9999/cb&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz"
```

```text
HTTP/1.1 302 Found
Location: http://localhost:5171/authorize/01a17968-6d57-7655-93cb-7bc4198b3538
…
```

The request is kept, and the browser would go on to auth's page for it. The client
named no `resource`, so the request is for the only product with an MCP server,
boards. The same request with `code_challenge_method=plain` goes to the error page
instead:

```text
HTTP/1.1 302 Found
Location: http://localhost:5171/error?message=The+application+does+not+protect+its+request+with+PKCE+%28S256%29
```

Be auth's page. Read the request, try to approve it without signing in, sign up with a
cookie jar, and approve it:

```sh
ID=01a17968-6d57-7655-93cb-7bc4198b3538   # yours
curl -s localhost:3001/api/authorizations/$ID
curl -s -X POST localhost:3001/api/authorizations/$ID/approve
curl -s -c jar -X POST localhost:3001/api/session/sign-up -H 'content-type: application/json' \
  -d '{"email":"ana@cooper.test","name":"Ana","password":"a long password"}' > /dev/null
curl -s -b jar -X POST localhost:3001/api/authorizations/$ID/approve
```

```text
{"id":"01a17968-6d57-7655-93cb-7bc4198b3538","clientName":"My MCP client","product":{"id":"cooper","name":"Cooper","signUp":true},"firstParty":false,"redirectHost":"localhost:9999","open":true,"refused":null}
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
{"redirectTo":"http://localhost:9999/cb?code=cooper_ac_T2cOd7_f1NJKqg9Q2LBvyhU-WfD5M6_XY3dFHbvlIg8&state=xyz"}
```

The browser would go back to the client with a code and its `state`. Be the client
again, and trade the code:

```sh
CODE=cooper_ac_T2cOd7_f1NJKqg9Q2LBvyhU-WfD5M6_XY3dFHbvlIg8   # yours
curl -s localhost:3001/oauth/token -d grant_type=authorization_code -d code=$CODE \
  -d code_verifier=$VERIFIER -d client_id=$CID -d redirect_uri=http://localhost:9999/cb
```

```text
{"access_token":"cooper_at_oAgwrni6QvFasjpqX-5ZIlR-3xd82wz-_K8lnTuQugs","token_type":"Bearer","expires_in":3600,"refresh_token":"cooper_rt_OQ4xJ7z9vadkh99xgfOGTH4e3wQQ83XSOB_xrq4lp2A"}
```

Send the same request again, as someone who copied the code would:

```text
HTTP/1.1 400 Bad Request
Cache-Control: no-store
Content-Type: application/json;charset=utf-8
Access-Control-Allow-Origin: *
…

{"error":"invalid_grant","error_description":"The code is not valid any more: start signing in again"}
```

and look at auth's database:

```sh
sqlite3 data/cooper-auth.db 'select status from oauth_grant; select count(*) from token'
```

```text
replayed
0
```

The grant is `replayed`, and the worker has deleted the tokens it gave: the access
token above opens nothing any more. A wrong secret for the backoffice's client, and a
grant type cooper does not give:

```sh
curl -s localhost:3001/oauth/token -u backoffice:wrong -d grant_type=authorization_code -d code=x -d code_verifier=y -d redirect_uri=z
curl -s localhost:3001/oauth/token -d grant_type=password -d client_id=$CID
```

```text
{"error":"invalid_client","error_description":"The client is unknown, or did not prove it is who it says"}
{"error":"unsupported_grant_type","error_description":"cooper gives tokens for a code or a refresh token"}
```

Last, sign out of auth on the way back to boards, then try to go somewhere else:

```sh
curl -si -b jar "localhost:3001/oauth/logout?redirect=http://localhost:5172/boards"
curl -s -b jar localhost:3001/api/session
curl -si "localhost:3001/oauth/logout?redirect=https://evil.test/" | grep -i location
```

```text
HTTP/1.1 302 Found
Location: http://localhost:5172/boards
Set-Cookie: cooper_auth_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
…
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
Location: /
```

## What to remember

- Addresses with a format of their own (OAuth's, `/.well-known`, later MCP) are a
  router at the root: `new HttpRouter({ prefix: '' })`. It takes only its paths. Its
  options are each route's defaults, `public: true` among them. A context serves it
  beside its API through `serve`'s `routes`, which cooper's contexts fill by
  overriding `routes()`.
- A route answers its errors its own way with `onError`. OAuth's endpoints use
  `toOauthErrorResponse(error, fallback, codes)`: `{ error, error_description }`, the
  domain error's status, `codes` mapping cooper's error codes to OAuth's. A page the
  browser visits may redirect instead, never to an address nobody vouched for.
- A route that pages of other origins call says so with `cors`. Never with cookies:
  what such a page proves, it proves with a token.
- A public route runs as nobody. To show more to whoever is signed in, it reads the
  session itself and uses `runAsActor`; the use case asks `findCurrentActor()`, which
  returns `undefined` instead of throwing.
- Secrets are hashes behind a public schema. Something that must happen once (a code
  spent) says `retryOnConflict: false`; what the request must give at once is
  `writesTo`; what follows from it in another module (revoking copied tokens) is an
  event and a worker.

Next: [Signing in to boards: the web session](./22-web-session).
