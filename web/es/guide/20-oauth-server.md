# Un servidor OAuth con newt

La gente entra en boards y en el backoffice. Los asistentes de IA se conectan al
servidor MCP de boards en nombre de alguien. Todos necesitan la misma respuesta:
¿quién es? cooper la da en un solo sitio, auth, que es un **servidor de autorización
OAuth 2.1**. Cada aplicación es un cliente OAuth suyo, y cada cliente MCP también.

Este capítulo no es un curso de OAuth. Enseña cómo se construye un servidor OAuth con
las piezas de siempre de newt: módulos, entidades, casos de uso, workers y rutas que
hablan el formato de OAuth.

## Los módulos de auth

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

| Módulo | Qué guarda |
|---|---|
| `product` | Las aplicaciones en las que se entra: `cooper` (boards) y `backoffice`. Declaradas en código. |
| `user` | Las cuentas: email, nombre, hash de la contraseña. |
| `session` | La sesión de navegador del propio auth, al entrar en sus páginas. |
| `access` | Quién puede entrar en qué producto: por espacio en `cooper`, en todo él en `backoffice`. |
| `tenant` | Los espacios de trabajo de `cooper`. |
| `invitation` | Las invitaciones a un espacio. |
| `oauthClient` | Los clientes OAuth: el de cada producto, y los clientes MCP que se registran solos. |
| `oauthGrant` | Las peticiones de autorización, la respuesta de la persona y el código. |
| `token` | Los tokens de acceso y de refresco. |

## Usuarios y la sesión del propio auth

Un usuario es un email (el value object `Email` de newt), un nombre y el hash de su
contraseña (`Bun.password`). Comprobar una contraseña tarda lo mismo con un email que
no existe que con una contraseña equivocada, así que el tiempo no delata nada:

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

`session` guarda la cookie del propio auth, en el origen de auth. Es el autenticador
del router: cada ruta de la API de auth corre como quien diga esa cookie. Con una
sesión en auth, la persona entra en todos los productos: cada producto abre luego su
propia sesión a través de OAuth.

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
static initialize(base: AuthBase, deps: Session_Deps, options: Session_Options): Session_Module {
  const module = new Session_Module(base, new Session_Repository(base), deps, options)
  base.http.authenticateWith(request => module.authenticate(request.cookies.get(SessionCookie) ?? undefined))
  registerSessionRoutes(base, module)
  return module
}
```

## Productos, declarados en código

Un producto es una pieza del sistema, no un dato que alguien edita. Así que cooper
declara sus productos en el código, y el módulo `product` no tiene entidad ni
repositorio:

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

- `signUp`: si alguien puede crearse una cuenta de camino a él.
- `access`: puede entrar `'anyone'` con cuenta, o solo a quien se le dio acceso,
  `'granted'` (el equipo, en el backoffice).
- `mcpResource`: la dirección de su servidor MCP, si tiene uno. Los clientes MCP
  piden tokens para ese recurso.

Un módulo sin store sigue siendo un módulo: sus casos de uso son lo que llaman los
demás (`product.get`, `product.forResource`).

## Tenants y accesos

Un espacio de trabajo es un **tenant**; quién pertenece a él es un **acceso**
`(userId, productId, tenantId)`. El acceso a `cooper` es por tenant. El acceso a
`backoffice` tiene `tenantId: null`: abre todo el producto. `access.check` es lo que
pregunta cada contexto antes de dejar entrar a alguien, cada vez:

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

El [capítulo 8](./08-rules-over-rows) cuenta lo de un solo administrador por tenant,
y el [capítulo 16](./16-sagas) el borrado de un tenant entre auth y boards.

## Clientes OAuth

Hay dos tipos:

- **El cliente propio de un producto.** Confidencial: tiene un secreto, guardado en
  su servidor. Su `client_id` es el id del producto. auth los crea o los pone al día
  cada vez que se abre, a partir del código y la configuración.
- **Un cliente registrado.** Público: un cliente MCP se registra solo (RFC 7591),
  sin secreto. Demuestra quién es con PKCE.

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

El secreto es un value object. El store guarda solo su hash, y se compara en tiempo
constante:

```ts
// cooper/backend/contexts/auth/modules/oauth-client/value-objects/client-secret.ts
/** Whether `presented` is the secret of this hash, in constant time: how long it takes says nothing. */
matches(presented: string, hash: string): boolean {
  return timingSafeEqual(Buffer.from(hashOf(presented), 'hex'), Buffer.from(hash, 'hex'))
},
```

Cualquiera puede registrar un cliente: no abre nada hasta que una persona le dice que
sí. Sus direcciones de vuelta tienen que ser `https`, o `http` en localhost:

```ts
// cooper/backend/contexts/auth/modules/oauth-client/oauth-client.schema.ts
export const OauthClientRedirectUriSchema = z.url('Write a valid address').refine(uri => {
  const url = new URL(uri)
  if (url.hash) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname))
}, 'A redirect address is https, or http on localhost')
```

## Grants: el código de autorización con PKCE

Un `oauthGrant` es una petición de autorización, desde que un cliente manda el
navegador a auth hasta que cambia el código:

1. **`request`**: el cliente manda el navegador a `/oauth/authorize`. auth comprueba
   el cliente, su dirección de vuelta y el reto PKCE (solo S256), guarda la petición
   y manda el navegador a su propia interfaz.
2. **`review`**: la interfaz de auth enseña quién pide acceso.
3. **`approve`** o **`deny`**: la persona, ya dentro, responde. El cliente propio de
   un producto (first party) se aprueba al entrar; cualquier otro pide
   consentimiento. Un producto con `access: 'granted'` comprueba que la persona
   tiene acceso.
4. **`redeem`**: el cliente cambia el código, una sola vez, con su verificador PKCE.

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

La entidad guarda las reglas de OAuth. El código se genera con el `SecretToken` de
newt y solo se guarda su hash. PKCE es comparar un hash:

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

Un código que llega por segunda vez es que alguien lo copió (RFC 6749 §4.1.2). El
grant se marca `replayed`, con un evento. Un worker de `token` revoca lo que se
obtuvo con ese código: lo irreversible sale de un worker, como siempre
([capítulo 14](./14-irreversible)).

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

Los tokens son **opacos**: cadenas aleatorias con un prefijo (`cooper_at_`,
`cooper_rt_`) para que las personas y los detectores de secretos los reconozcan. El
store guarda solo sus hashes. Cualquier contexto pregunta a auth para quién es un
token, en el mismo proceso, con `token.verify`.

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

`exchange` es un `writesTo` con sus porqués ([capítulo 17](./17-modules-talk)) y un
`retryOnConflict: false` ([capítulo 7](./07-concurrency)): repetirlo presentaría el
código gastado por segunda vez, que es exactamente lo que parece un código copiado.

Cada refresco **rota** los dos tokens. El token de refresco al que sustituyó, si
vuelve a llegar, es que alguien lo copió: `refresh` revoca los tokens.

## Los endpoints

Los endpoints de OAuth no son parte de la API JSON de auth. Viven fuera de `/api`, y
hablan el formato de OAuth: un formulario de entrada, `{ error, error_description }`
de salida. Así que la base de auth tiene un segundo router, con su propio prefijo:

```ts
// cooper/backend/contexts/auth/auth-base.ts
export class AuthBase extends CooperBase {
  readonly oauth = new HttpRouter({ prefix: '/oauth' })
}
```

El contexto lo sirve junto a su API, con los metadatos del servidor (RFC 8414):

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

| Endpoint | Qué hace |
|---|---|
| `GET /.well-known/oauth-authorization-server` | Dice dónde está todo lo demás. |
| `GET /oauth/authorize` | `oauthGrant.request`, y el navegador a la interfaz de auth. |
| `POST /oauth/token` | `token.exchange` (`authorization_code`) o `token.refresh` (`refresh_token`). |
| `POST /oauth/register` | `oauthClient.register` (RFC 7591). |
| `POST /oauth/revoke` | `token.revoke` (RFC 7009). |
| `GET /api/authorizations/:id`, `POST …/approve`, `POST …/deny` | Para la interfaz de auth: la petición y la respuesta de la persona. |

Los endpoints que un cliente MCP llama por sí mismo están abiertos a cualquier origen
(CORS): algunos clientes, como el MCP inspector, funcionan en un navegador.
`/oauth/authorize` no: a ese va el navegador.

Como toda ruta en newt, estas solo traducen HTTP a una llamada a un caso de uso, y
de vuelta:

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

## Errores en el formato de OAuth

Los errores de dominio siguen siendo errores de dominio: `InvalidClient` es un
`UnauthorizedError`, `InvalidGrant` un `ValidationError`, cada uno con su código. La
API los respondería como `{ error, code }`. Un cliente OAuth espera
`{ error, error_description }` (RFC 6749 §5.2), con los nombres de error de OAuth.
`toOauthErrorResponse` de newt hace la traducción:

```ts
// packages/newt/http/to-oauth-error-response.ts
/**
 * What an OAuth client receives when a request fails: `{ error, error_description }`
 * (RFC 6749 §5.2), not the API's `{ error, code }`. `codes` names the OAuth error of each
 * domain error code; anything else that is the request's fault is `fallback`.
 */
export function toOauthErrorResponse(error: unknown, fallback: string, codes: Record<string, string> = {}): Response {
```

La ruta le pasa el mapa de códigos de dominio a nombres de OAuth:

```ts
// cooper/backend/contexts/auth/modules/token/token.routes.ts
/** The OAuth error of each of the errors these endpoints may meet. */
const OAUTH_ERRORS = {
  'oauthClient.invalid_client': 'invalid_client',
  'oauthGrant.invalid_grant': 'invalid_grant',
  'token.invalid_grant': 'invalid_grant',
}
```

El status sale del error de dominio (401 para `invalid_client`, 400 para
`invalid_grant`). Cualquier cosa inesperada es un 500 `server_error`, y se registra.

`/oauth/authorize` es distinto: responde a un navegador, no a un cliente. Una
petición que auth no puede atender nunca se devuelve a una dirección de la que nadie
responde. El navegador va a la página de error de auth.

## La sesión web: cada aplicación es un cliente confidencial

boards y el backoffice hacen entrar a su gente a través de auth, y los dos lo hacen
igual. La parte común es un módulo en `cooper/backend/shared/web-session`. El
**servidor** de la aplicación hace el OAuth (un backend para su frontend): el
navegador solo tiene la cookie de sesión de la propia aplicación, nunca un token.

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

Registra cuatro rutas y el autenticador del router:

- `GET /api/session/sign-in?returnTo=/ruta`: un state y un verificador PKCE en una
  cookie corta, y el navegador al `/oauth/authorize` de auth.
- `GET /api/session/callback`: auth devuelve el navegador con un código. El servidor
  lo cambia en el `/oauth/token` de auth, por HTTP de verdad, con su secreto.
- `GET /api/session`: la persona que ha entrado. `POST /api/session/sign-out` la
  saca.

La vuelta es donde todo encaja:

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

Fíjate:

- **El código se cambia por HTTP**, como lo haría cualquier cliente OAuth. Preguntar
  para quién es el token es una **llamada en el mismo proceso** (`identify`, el
  `token.verify` de auth): los dos contextos corren en el mismo proceso.
- **La aplicación no guarda ningún token.** Solo necesitaba saber quién entró.
  Devuelve los tokens y abre su propia sesión, en su propio store (el módulo trae su
  migración, que cada contexto copia en las suyas).
- **`retryOnConflict: false`**: llamó a auth antes de guardar. Repetirlo presentaría
  un código ya gastado.

## Cómo comprobarlo

El test de OAuth de auth recorre todo el flujo por HTTP, como lo haría un cliente MCP:

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

Un código cambiado dos veces falla en el formato de OAuth, y un worker revoca los
primeros tokens:

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

Con cooper en marcha (`bun run cooper`), pregunta a auth dónde está todo:

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

Las direcciones son la URL pública de auth, en desarrollo el servidor de su interfaz,
que pasa `/oauth` y `/.well-known` al puerto 3001.

## En resumen

- Un servidor OAuth son **módulos como cualquier otro**: clientes, grants y tokens,
  con sus entidades, casos de uso, eventos y workers.
- Lo que es parte del sistema, como los **productos**, se declara en código, no se
  guarda.
- **Secretos, códigos y tokens se guardan como hashes.** Se comparan en tiempo
  constante.
- Los endpoints de OAuth viven en **su propio router**, fuera de `/api`, y responden
  los errores con **`toOauthErrorResponse`**: errores de dominio de entrada,
  `{ error, error_description }` de salida.
- Cada contexto pregunta a auth con **`token.verify`** para quién es un token, en el
  mismo proceso.
- Cada aplicación es un **cliente confidencial** cuyo servidor hace el OAuth. El
  navegador tiene la cookie de sesión de la aplicación, nunca un token.
