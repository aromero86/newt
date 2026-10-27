# Iniciar sesión en boards: la sesión web

Desde el [capítulo 2](./02-first-module), boards cree a quien le envía una petición: una
cabecera `x-user` dice quién es, y cualquiera puede escribir en ella el id de cualquier
otro. El capítulo [17](./17-auth) dio a auth cuentas y sesiones propias, y el capítulo
[21](./21-oauth-server) lo convirtió en un servidor OAuth. auth ya conoce a boards: declara
el producto `cooper` como un **cliente confidencial** de OAuth, con un secreto y una URI de
redirección, la URL pública de boards seguida de `/api/session/callback`. En esa dirección
todavía no responde nada.

Este capítulo convierte a boards en ese cliente, y la cabecera `x-user` desaparece para
siempre.

Quien hace el OAuth es el **servidor** de boards, no la página en el navegador. Esto se
suele llamar un backend para el frontend. El navegador solo guarda la cookie de sesión
propia de boards, nunca un token de auth. Un script inyectado en una página de boards no
tiene nada que robar, y el secreto del cliente nunca sale del servidor. Un inicio de
sesión va así:

1. El navegador abre `GET /api/session/sign-in?returnTo=/` en boards. boards genera un
   `state` aleatorio y un verificador PKCE, los guarda en una cookie corta, y envía al
   navegador al `/oauth/authorize` de auth.
2. En auth, la persona inicia sesión o se registra, y dice que sí. Las páginas de auth
   llegan en el [capítulo 23](./23-frontends); en este capítulo las manejas a través de la
   API de auth.
3. auth devuelve el navegador al `/api/session/callback` de boards con un `code` y el
   `state`.
4. El servidor de boards comprueba el `state` contra su cookie, canjea el código en el
   `/oauth/token` de auth con su secreto y el verificador, y le pregunta a auth para quién
   es el token de acceso. Devuelve los tokens, abre una sesión propia y pone su cookie.
5. Cada otra petición a boards se ejecuta como quien diga esa cookie.

El backoffice (capítulo [25](./25-backoffice)) inicia sesión a su personal de la misma
forma. Por eso el código no es de boards: es un módulo en `shared/web-session/`, que cada
contexto inicializa con sus propias opciones y cuya tabla vive en el store de ese contexto.

El capítulo 21 ya hizo un archivo de esa carpeta, `web-session.schema.ts`, con
`WEB_SESSION_CALLBACK`: auth necesitaba la ruta del callback para declarar la URI de
redirección de cada producto. Este capítulo añade el resto.

## Su configuración

boards necesita tres ajustes más: dónde está auth, el secreto de su cliente y cuánto dura
una sesión. `publicUrls`, `clientSecrets` y `sessionDays` ya están en `config.ts` (los usa
auth). Añade las tres últimas líneas de `boards`:

```ts
// cooper/backend/config.ts
// …
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** Where it listens (`COOPER_BOARDS_PORT`). */
    port: ports.boards,
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

`authPublicUrl` es la URL **pública** de auth, donde la gente la abre, no su puerto: el
navegador va ahí, y también el servidor de boards cuando llama a `/oauth/token`. En
desarrollo cada URL pública es el puerto propio de su contexto (`localhost:3001` para
auth, `localhost:3002` para boards), donde sirve sus páginas junto a su API desde el
capítulo 23; en producción, su propio dominio.

## Las cookies

La sesión web de un contexto tiene dos cookies. Reemplaza `web-session.schema.ts`:

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

- **Los nombres llevan el nombre del contexto**, como `cooper_auth_session` de auth en el
  [capítulo 17](./17-auth). Los navegadores guardan las cookies por nombre de host, no por
  puerto: en desarrollo todos los contextos están en `localhost`, así que se ven las
  cookies unos de otros. `cooper_boards_session` y `cooper_auth_session` no pueden ser la
  misma cookie.
- **`signIn`** vive solo mientras la persona está en auth: guarda el `state`, el
  verificador PKCE y adónde volver. Su contenido no es secreto para la persona, pero el
  `state` que lleva es lo que prueba que el callback responde a un inicio de sesión que
  este navegador empezó.
- **`WebSessionSignOutDTO`** es lo que responde el cierre de sesión: la dirección del
  cierre de sesión de auth, adonde va el navegador después. Es un tipo que lee el frontend
  (capítulo 23).

## La sesión

Una sesión web es la `Session` de auth del capítulo 17 otra vez, en otro contexto: el
navegador guarda un `SecretToken`, el store solo su hash.

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

Una cosa difiere del capítulo 17: lee la hora con **`now()`**, no con `Date.now()`.
`WebSession.open` e `isExpired` se ejecutan dentro de los casos de uso del módulo, así que
van por el reloj del contexto que los ejecuta, el de boards o el del backoffice. Un test
que le da un reloj a boards mueve también cuándo caducan sus sesiones. boards todavía no
tiene reloj: lo recibe más abajo.

Su repositorio es un `TableRepository` normal sobre una tabla llamada `session`:

```ts
// cooper/backend/shared/web-session/web-session.repository.ts
import { TableRepository } from 'newt/repository'
import type { CooperBase } from '../cooper-base'
import { WebSession, type WebSessionDTO } from './web-session'

export type WebSessionRow = WebSessionDTO & { version: number }

/** The context's `session` table: each context has its own, made by the migration it copies. */
export class WebSession_Repository extends TableRepository<WebSession, WebSessionRow, CooperBase> {

  constructor(base: CooperBase) {
    // No scope: a session is a person's, found by its token, in no workspace.
    super(base, base.store.table<WebSessionRow>('session'), { scope: 'none' })
  }

  protected toEntity(row: WebSessionRow): WebSession {
    return WebSession.fromDTO(row)
  }
}
```

El repositorio recibe una `CooperBase`, la base de cualquier contexto. Qué tabla `session`
escribe depende de la base que se le dé: la base de boards escribe la base de datos de
boards. Su ámbito es `'none'`, como el de las sesiones de auth (capítulo
[17](./17-auth)): una sesión es de una persona, se encuentra por su token, y no está en
ningún espacio de trabajo.

## Su tabla, en el store de cada contexto

El módulo trae su migración en su propia carpeta, `migrations/sqlite/`:

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

Es la misma tabla que la `session` de auth, y no hay choque: cada contexto tiene su propia
base de datos. Pero un store ejecuta las migraciones de **una** carpeta, la de su contexto
(capítulo [5](./05-sqlite)). Así que cada contexto que inicializa el módulo copia estos dos
archivos a sus propias migraciones, numerados después de los que ya tiene. boards tiene
cinco, así que su copia es `00006_session`:

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

La copia de `shared/web-session/` es la fuente que copia cada contexto, y con la que el
test propio del módulo abre su store (más abajo). Una vez que la copia de boards se ha
ejecutado, es una migración de boards como cualquier otra: no se edita nunca.

## Sus errores

Un inicio de sesión puede fallar de tres maneras, cada una con su propio código:

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

- **`SignInExpired`**, un `ValidationError` (400): el navegador volvió sin cookie de inicio
  de sesión, porque tardó más de diez minutos, o era otro navegador, o el `state` no es el
  de la cookie.
- **`SignInDenied`**, un `ForbiddenError` (403): auth devolvió el navegador con un `error`
  en lugar de un código. La persona dijo que no, o no puede entrar en el producto.
- **`SignInFailed`**, un `UnauthorizedError` (401): auth no quiso canjear el código, o el
  token que dio no dice nada de este cliente.

Una persona nunca ve esto como JSON: el callback es una página que abre el navegador, así
que la ruta lo convierte en una redirección (más abajo).

## Sus opciones

Lo que un contexto le dice al módulo:

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

El módulo no importa auth. En su lugar recibe dos funciones:

- **`identify`**: para quién actúa un token de acceso. boards le da el `token.verify` de
  auth, un caso de uso al que llama en el mismo proceso.
- **`profile`**: lo que `GET /api/session` responde para la persona con sesión iniciada.
  Cada contexto elige lo que muestra su UI.

Así el módulo es el mismo para boards y para el backoffice, y un test puede darle
cualquier contexto.

## El módulo

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

Sus cinco casos de uso:

- **`begin`** genera el `state` y el verificador PKCE, ambos con `SecretToken.generate()`,
  y el desafío (challenge), el SHA-256 del verificador en base64url (`S256`). Responde
  adónde enviar el navegador, el `/oauth/authorize` de auth con el id del cliente, su URI
  de redirección, el desafío y el state, y `pending`, lo que guarda la cookie de inicio de
  sesión: el state, el verificador y `returnTo`, como JSON en base64url. No se escribe nada
  en el store: un inicio de sesión que nunca vuelve no deja nada atrás.
- **`complete`** es el callback. Lee la cookie y compara su `state` con el que envió auth,
  antes que nada: un callback que este navegador no empezó es `SignInExpired`, lleve lo que
  lleve. Luego canjea el código en `/oauth/token`, con el verificador, y le pregunta a
  `identify` para quién es el token de acceso. La respuesta tiene que ser para el producto
  de este cliente: un token para otro producto es `SignInFailed`. boards no guarda ningún
  token: saber quién inició sesión era todo lo que necesitaba. Así que devuelve el token de
  refresco en `/oauth/revoke`, que revoca también el token de acceso. Después abre su
  propia `WebSession` y responde el token para la cookie.
- **`authenticate`**: quién envió una petición, a partir del token de la cookie. Una sesión
  caducada se cierra por el camino, y nadie tiene la sesión iniciada.
- **`me`**: la persona con sesión iniciada, como la describe `profile`. No es pública, así
  que `currentActor()` siempre está.
- **`signOut`** cierra la sesión del token, si la hay: cerrar sesión dos veces es cerrarla
  una.

Algunos detalles:

- **`retryOnConflict: false` en `complete`.** En el capítulo [8](./08-two-people-one-card)
  un caso de uso se vuelve a ejecutar ante un `ConcurrencyConflict`. Este llama a auth por
  HTTP antes de guardar, y un código solo se puede canjear una vez: una segunda ejecución
  traería el código ya gastado, y auth respondería como ante uno robado (capítulo 21: un
  código traído otra vez revoca lo que dio). Una sesión nueva nunca entra en conflicto, de
  todos modos, pero el caso de uso dice que no debe ejecutarse dos veces.
- **`post`** envía un formulario a auth como este cliente, con `client_secret_basic`: el id
  y el secreto del cliente en una cabecera `Authorization: Basic`, cada uno codificado
  antes como URL. Va por HTTP a la URL pública de auth, como iría si auth fuera el servidor
  de otra empresa. Un rechazo de auth se convierte en `SignInFailed`, con el
  `error_description` de auth.
- **`ownPath`** mantiene `returnTo` como una ruta del propio contexto. Un enlace a
  `sign-in?returnTo=//evil.example` no debe enviar a la persona, ya con la sesión iniciada,
  a otro sitio tras el callback: para un navegador `//host` es otro host, y también lo es
  `/\host`. Todo lo que no sea una ruta normal se convierte en `/`.
- **`find`** comprueba el valor de la cookie con `SecretToken.schema` antes de buscarlo:
  una cookie que no es un token no encuentra nada, sin hacer ninguna consulta.

## Sus rutas, y el autenticador

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

**El módulo pone el autenticador.** Un router tiene un autenticador: la función que dice
quién envió cada petición, `null` cuando no fue nadie. Cada llamada a `authenticateWith`
reemplaza la anterior, y se usa la última que se puso. Su primera línea aquí le da al router
de boards el de la sesión web: toda ruta de boards que no sea pública se ejecuta ahora como
quien diga la cookie, y una petición sin una cookie válida recibe un 401, `not_signed_in`,
antes de que la ruta se ejecute. El módulo de sesiones de auth hizo lo mismo para auth en
el capítulo 17. El módulo que conoce las sesiones lo pone; nada más necesita hacerlo.

Las cuatro rutas:

- **`GET /session/sign-in`** es pública: todavía nadie ha iniciado sesión. Pone la cookie de
  inicio de sesión y responde con un 302 a auth. La cookie se devuelve solo a las rutas
  bajo `/api/session`, y dura diez minutos (`SIGN_IN_SECONDS`).
- **`GET /session/callback`** también es pública. Primero borra la cookie de inicio de
  sesión: la cookie se usa una vez, pase lo que pase después. Si todo va bien, pone la
  cookie de sesión y redirige a `returnTo`. Un `DomainError` (los tres de arriba) se
  convierte en una redirección a `/?signInError=<code>`, el inicio del frontend, que dice
  qué fue mal. Cualquier otro error no es culpa de la persona: se vuelve a lanzar, y se
  responde como un 500.
- **`GET /session`** es la persona con sesión iniciada. No es pública.
- **`POST /session/sign-out`** es pública, como la de auth: alguien cuya sesión ya terminó
  también consigue que le limpien la cookie. Responde `{ next }`: el `/oauth/logout` de
  auth, que termina también la sesión de auth y devuelve el navegador a boards. Sin eso,
  volver a iniciar sesión metería a la misma persona en auth sin preguntar, y nadie podría
  cambiar de cuenta. `?returnTo=` (la página de una invitación, por ejemplo) es adonde auth
  devuelve el navegador, y `ownPath` lo mantiene como una ruta de boards.

`keep` pone la cookie de sesión con los atributos de la del capítulo 17: `httpOnly`,
`sameSite: 'lax'`, `secure` cuando la URL pública del contexto es https, ruta `/`, y tan
larga como la sesión. `sameSite: 'lax'` es lo que permite que la cookie llegue siquiera en
el callback: es una navegación de nivel superior desde el sitio de auth, que `lax` permite
y `strict` no.

## boards inicia sesión a través de él

boards inicializa el módulo primero en `initializeModules`, y le entrega el `token` de auth
a través de `Boards_Auth`. Añade los dos imports:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
// …
```

añade el módulo `token` de auth a los que elige `Boards_Auth`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
// …
/**
 * auth's modules `boards` uses, as its own modules use each other: who an access
 * token is for (the web session, the MCP server), who belongs to each workspace
 * (`member`), auth's events about workspaces and access, and what boards' routes for
 * workspaces, members and invitations manage in auth.
 */
export type Boards_Auth = Pick<Auth_Modules, 'token' | 'user' | 'tenant' | 'access' | 'invitation'>
// …
```

e inicializa la sesión antes que los demás módulos, devolviéndola con ellos:

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
  const { user, tenant, access, invitation } = deps.auth
  const member = Member_Module.initialize(base, { auth: { access, tenant, user } })
// …
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { session, member, board, column, card, workspace, activity, outbox }
}
```

- **`clientId: WORKSPACES_PRODUCT`** es `'cooper'`, el producto cuyo cliente declaró auth
  en el capítulo 21. Su URI de redirección allí es `boardsPublicUrl` y
  `WEB_SESSION_CALLBACK`; aquí el módulo la construye a partir de `publicUrl` y la misma
  constante. Las dos vienen del mismo `publicUrls.boards`, así que coinciden.
- **`identify`** es el `token.verify` de auth: responde `{ userId, productId, … }` para un
  token de acceso válido, y `null` en cualquier otro caso.
- **`profile`** le da a la UI de boards el id, el nombre y el email de la cuenta, bajo
  `user`, y nada más de lo que guarda auth.

El lint ya deja que boards importe de auth (capítulo [20](./20-wiring-contexts)), y
`shared/` es de cualquiera.

`openContexts` no cambia: le da a boards `auth.modules`, que ya tiene `token`.

## El reloj llega a boards

El capítulo [19](./19-invitations-and-time) le dio un reloj a auth. boards no lo necesitaba:
nada en él caducaba. Ahora sus sesiones sí. `Boards_Context.open` recibe un reloj y se lo
da a su base, como hace `Auth_Context.open`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
// …
/**
 * The SaaS: each workspace's boards, their columns and cards. Its people sign in
 * through `auth`, which also keeps the workspaces and who belongs to each: `boards`
 * is handed auth's modules when it opens, and calls their use cases as its own.
 */
// …
  /** Opened after `auth`, which it uses; on the real time, unless a test gives it a `clock`. */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, clock?: Clock): Promise<Boards_Context> {
    // Brought up to date as it opens: the migrations it has not run yet, in order.
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new BoardsBase({ name: 'boards', store, clock })
// …
```

y `openContexts` le da a boards el mismo reloj que a auth:

```ts
// cooper/backend/open-contexts.ts
// …
  const boards = await Boards_Context.open(config.boards, { auth: auth.modules, mailer, search: new MemoryCardSearch(), log: line => console.log(line) }, clock)
// …
```

Un reloj para todos los contextos. Un test que lo adelanta un mes adelanta a la vez las
sesiones de auth y las de boards: no pueden discrepar sobre qué hora es. Sin reloj, boards
va con la hora real, como antes.

## La cabecera `x-user` desaparece

`index.ts` pierde el autenticador que puso en boards el capítulo 2. Ahora el módulo de
sesión web pone el de boards. Reemplázalo:

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

El comentario del contexto servido dice por qué las sesiones de cada contexto son suyas:

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

Los tests propios de boards son el único sitio donde la cabecera se queda. Ejecutan boards
contra `FakeAuth`, sin ningún auth donde iniciar sesión, y tratan de las reglas de boards,
no del inicio de sesión. `openTestBoards` ya ponía un autenticador `x-user`. Como el módulo
ahora pone el de la sesión web cuando el contexto se abre, la llamada del test viene
después y lo reemplaza: gana la última que se puso. Solo cambia su comentario:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
// …
/**
 * `boards` for a test: its database and its cards' search in memory, a fake auth's
 * modules, its emails and its log's lines in lists, and who sends a request
 * told by an `x-user` header (the real authenticator, the web session's, is replaced).
 */
// …
```

El `modules` de `FakeAuth` tiene que tener ahora también un `token` (capítulo 20). Los
tests propios de boards nunca inician sesión, así que no alcanzan nada de él: un módulo
falso rechaza cualquier caso de uso que se le pida. Añádelo, en `testing/fake-auth.ts`:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
      token: fakeModule('token', {}),
      invitation: fakeModule('invitation', {}),
    } as Boards_Auth
```

## Probar un inicio de sesión: `newt/testing`

Un inicio de sesión es un viaje de ida y vuelta entre dos servidores, con redirecciones y
cookies. Un test suyo necesita dos cosas que `fetch` no da, y **`newt/testing`** las da.

**`browser(baseUrl?)`** es el navegador de una persona: un `fetch` con un almacén de
cookies. El test del módulo (más abajo) empieza cada inicio de sesión con él:

```ts
const as = browser()
const started = await as(clientUrl(`/api/session/sign-in?returnTo=${encodeURIComponent(returnTo)}`))
expect(started.status).toBe(302)
const authorize = started.headers.get('location')!
expect(authorize).toStartWith(authUrl('/oauth/authorize?'))
```

- Guarda las cookies que pone cada host, las devuelve a ese host, y olvida las que un
  servidor borra (un valor vacío, `Max-Age=0`, o una caducidad en el pasado).
- **Nunca sigue una redirección** (`redirect: 'manual'`). El test ve cada 302 y su
  `Location`, y lo abre él mismo cuando quiere. Un inicio de sesión es una cadena de
  redirecciones; el test comprueba cada eslabón.
- `json` envía un cuerpo como JSON, con su tipo de contenido.
- Sus almacenes son por **host**, puerto incluido. Un navegador real guarda las cookies solo
  por nombre de host, y por eso las cookies llevan el nombre del contexto; en un test, dos
  servidores en dos puertos nunca ven las cookies del otro.
- Dos llamadas a `browser()` son dos personas: la segunda no tiene ninguna cookie de la
  primera. Así muestra un test que un extraño no puede terminar el inicio de sesión de
  otra persona.

**`freePort()`** es un puerto en el que no escucha nadie ahora. Los servidores de un inicio
de sesión tienen que conocer sus direcciones antes de arrancar: auth se nombra a sí mismo
en sus metadatos OAuth, la URI de redirección de boards lleva su puerto, y la configuración
de cada contexto nombra la URL pública del otro. El puerto 0, "cualquier puerto libre",
solo se conoce cuando el servidor ya está en marcha, demasiado tarde. `freePort` abre un
servidor en el puerto 0, lee su puerto y lo cierra.

El `cooper.test.ts` del capítulo 20 ya usaba las dos, con un `signUp` de relleno. Ahora
inicia la sesión de la gente como lo hará la UI de boards.

### El test de cooper inicia sesión a través de boards

En `cooper.test.ts`, cada contexto nombra ahora la URL pública del otro:

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

La URL pública de cada contexto es su propio servidor, en un puerto del test: `freePort`
da los dos puertos antes de que se abra nada. `beforeEach` ya no pone un autenticador `x-user` en
boards; boards tiene el de la sesión web:

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

Añade `authUrl` junto a `boardsUrl`, y reemplaza `signUp`:

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

Cada línea es un paso del inicio de sesión, como lo da el navegador de una persona:

1. El inicio de sesión de boards: un 302 al `/oauth/authorize` de auth, y la cookie de
   inicio de sesión en el almacén, para el host de boards.
2. El `/oauth/authorize` de auth guarda la petición y envía el navegador a su página,
   `/authorize/<id>`. El test toma el id.
3. El registro en auth, lo que enviará su página: una cuenta, y la cookie de sesión de auth
   en el almacén, para el host de auth.
4. La aprobación, lo que enviará la página de auth cuando la persona diga que sí: auth
   responde adónde va el navegador, el callback de boards con un código.
5. El callback: boards canjea el código, pone su cookie de sesión, y envía el navegador a
   `/`.

Desde entonces `as` es esa persona en ambos servidores. Todos los demás tests del archivo
usan `signUp` y `call` como antes, sin cambios: se ejecutaban con una cabecera `x-user`, y
ahora con una cookie de sesión. El primero pregunta además quién tiene la sesión iniciada:

```ts
// cooper/backend/cooper.test.ts
// …
    const { as, id } = await signUp('ana@cooper.test', 'Ana')
    expect(await call(as, 'GET', '/session')).toEqual({ status: 200, body: { user: { id, name: 'Ana', email: 'ana@cooper.test' } } })
// …
```

### El test propio del módulo

La sesión web es código compartido: su test no usa boards. Crea un contexto propio,
`Client_Context`, con el módulo, la carpeta de migraciones del propio módulo, y una ruta que
responde quién pregunta:

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

- **`Client_Context`** se hace pasar por boards: es el cliente `cooper`, y auth se abre con
  `boardsPublicUrl` puesto a la URL del cliente, así que la URI de redirección que declara
  auth es la del cliente. Abre su store con `shared/web-session/migrations/sqlite`, la
  carpeta de la que copia cada contexto: el test prueba que esos archivos crean la tabla
  que el módulo necesita.
- **El primer test** recorre el inicio de sesión entero: la petición que muestra auth es el
  cliente propio del producto (`firstParty`), el código vuelve, el navegador va a
  `returnTo`, y `/api/whoami` se ejecuta como la persona, `via: 'web'`. La tabla `token` de
  auth queda vacía después: el cliente devolvió sus tokens. El mismo callback una segunda
  vez no abre nada: el inicio de sesión al que respondía, su cookie, ya terminó, así que el
  cliente dice `session.sign_in_expired` antes de que el código llegue a auth. Que auth
  rechaza un código ya gastado lo muestra `oauth.test.ts` ([capítulo 21](./21-oauth-server)).
  Cerrar sesión termina las dos sesiones, y `returnTo` a la salida sigue siendo una ruta
  del cliente.
- **El segundo** trae el callback desde otro navegador, y luego con un `state` falsificado:
  ambos son `session.sign_in_expired`.
- **El tercero** dice que no en auth (`/deny`), e inicia el inicio de sesión con
  `returnTo=//evil.example/steal`: tras un inicio de sesión real el navegador aterriza en
  `/`.

## Compruébalo

Ejecuta la comprobación:

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

```text
 115 pass
 0 fail
```

Después inicia sesión a mano, con `curl` como navegador y un archivo como su almacén de
cookies. Arranca el backend; la URL pública de cada contexto es su propio puerto:

```sh
bun cooper/backend/index.ts
```

boards aplica su nueva migración a `data/cooper-boards.db` al abrirse. En otra terminal,
primero la cabecera que antes funcionaba:

```sh
curl -i -H 'x-user: x' localhost:3002/api/workspaces
```

```text
HTTP/1.1 401 Unauthorized
…
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

Empieza un inicio de sesión. `-c jar.txt -b jar.txt` guarda las cookies en `jar.txt` y las
devuelve:

```sh
curl -si -c jar.txt -b jar.txt 'localhost:3002/api/session/sign-in?returnTo=/'
```

```text
HTTP/1.1 302 Found
Location: http://localhost:3001/oauth/authorize?response_type=code&client_id=cooper&redirect_uri=http%3A%2F%2Flocalhost%3A3002%2Fapi%2Fsession%2Fcallback&code_challenge=32WzqL3Ob9mqzvDRCPm-Qb55pz4fmZhAER7hP6nDce4&code_challenge_method=S256&state=5IGuhE252rSpAwufpJPLTe92GWyXBecgLOrCcywcpYs
Set-Cookie: cooper_boards_sign_in=eyJzdGF0ZSI6…; Path=/api/session; Max-Age=600; HttpOnly; SameSite=Lax
```

Tu state, tu challenge y tus ids serán distintos de estos. Abre el `Location` en auth:

```sh
curl -si -c jar.txt -b jar.txt '<the Location above>'
```

```text
HTTP/1.1 302 Found
Location: http://localhost:3001/authorize/01a17968-de04-774c-942f-e4912b560deb
```

Esa es la página de auth, que sirve el capítulo 23. Haz lo que hará ella: regístrate, y
luego aprueba la petición con su id.

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

Sigue `redirectTo` de vuelta a boards:

```sh
curl -si -c jar.txt -b jar.txt '<the redirectTo above>'
```

```text
HTTP/1.1 302 Found
Location: /
Set-Cookie: cooper_boards_sign_in=; Path=/api/session; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
Set-Cookie: cooper_boards_session=fldknEx6JAPPCLvGfGkMN6I12PNKtMvneE_63q_FdPw; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax
```

La cookie de inicio de sesión ha desaparecido, y la cookie de sesión de boards está puesta
por treinta días. Pregúntale a boards quién eres, y por tus workspaces:

```sh
curl -s -b jar.txt localhost:3002/api/session
curl -s -b jar.txt localhost:3002/api/workspaces
```

```text
{"user":{"id":"01a17968-de64-7767-90e1-90437632728e","name":"Ana","email":"ana@cooper.test"}}
[]
```

Ana todavía no tiene ningún workspace. El almacén tiene ahora dos sesiones, una por
contexto, y ningún token de auth:

```sh
grep _session jar.txt
```

```text
#HttpOnly_localhost	FALSE	/	FALSE	1795630278	cooper_auth_session	acjJrN3bDv5qVMyboqEe3i3nl_mcv18LQ4HL2PeWn9U
#HttpOnly_localhost	FALSE	/	FALSE	1795630278	cooper_boards_session	fldknEx6JAPPCLvGfGkMN6I12PNKtMvneE_63q_FdPw
```

Detrás, boards guarda solo el hash de su token, y auth no guarda ningún token para el
cliente de boards: boards los devolvió.

```sh
sqlite3 data/cooper-boards.db "SELECT user_id, token_hash FROM session"
sqlite3 data/cooper-auth.db "SELECT count(*) FROM token"
```

```text
01a17968-de64-7767-90e1-90437632728e|6e1a8877cb9427cd0d09a431c4faaff2829d84a21ef15d650afcfaa20d42c464
0
```

Abre el mismo callback una segunda vez: la cookie de inicio de sesión ya se usó, y no se
abre nada.

```sh
curl -si -c jar.txt -b jar.txt '<the redirectTo above>'
```

```text
HTTP/1.1 302 Found
Location: /?signInError=session.sign_in_expired
```

Por último, cierra sesión:

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

`next` es adonde va un navegador para terminar también la sesión de auth. Detén el servidor
(Ctrl-C) y borra `jar.txt`.

## Qué recordar

- Un contexto que inicia sesión a su gente a través de auth es un cliente confidencial de
  OAuth, y su **servidor** hace el OAuth. El navegador guarda solo la cookie de sesión del
  propio contexto: ningún token, ni ningún secreto, llega nunca a la página.
- El callback se fía solo de lo que el navegador trajo en su propia cookie de inicio de
  sesión: el `state` tiene que coincidir, y el verificador PKCE prueba que el código es el
  que se pidió. `returnTo` es siempre una ruta del propio contexto.
- Un router tiene un **autenticador**, y lo pone el módulo que conoce las sesiones. Gana el
  último que se puso: un test que quiere otro pone el suyo después de abrir el contexto.
- El código compartido con una tabla trae su migración, y cada contexto la copia a las
  suyas, numerada después de las que ya tiene. El código es compartido; las filas son de
  cada contexto.
- **`newt/testing`**: `browser()` guarda las cookies de cada host y nunca sigue una
  redirección, así que un test recorre un inicio de sesión paso a paso; `freePort()` le da a
  un servidor su puerto antes de abrirse, para servidores que tienen que nombrarse entre
  sí.

Siguiente: [Los frontends y newt/contract](./23-frontends).
