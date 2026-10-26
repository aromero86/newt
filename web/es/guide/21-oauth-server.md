# Un servidor OAuth

auth hace que la gente inicie sesión, pero solo en el propio auth: su sesión es una cookie
en el origen de auth, que ninguna otra app de cooper puede leer. boards, abierto desde otra
dirección, sigue fiándose de una cabecera `x-user`. El backoffice necesitará lo mismo. Y un
asistente de IA que quiere usar boards por MCP (capítulo [24](./24-mcp-server)) no tiene
ninguna sesión de navegador: necesita un token que pueda enviar con cada llamada, dado con
el consentimiento de la persona.

Para eso sirve OAuth. Este capítulo convierte a auth en un **servidor OAuth 2.1**, con el
flujo de código de autorización y PKCE:

1. Un cliente envía el navegador al `/oauth/authorize` de auth, con la dirección donde
   quiere la respuesta (`redirect_uri`) y el hash de un secreto que solo él conoce
   (`code_challenge`).
2. auth guarda la petición y envía el navegador a su UI, que hace iniciar sesión a la
   persona y se lo pregunta. Si dice que sí, el navegador vuelve al cliente con un
   **código** de un solo uso.
3. El cliente cambia ese código, con el secreto que hay detrás del hash
   (`code_verifier`), en `/oauth/token`, por un **token de acceso** y un **token de
   refresco**.
4. Cualquier contexto que reciba el token de acceso pregunta a auth de quién es:
   `token.verify`.

auth tiene dos tipos de clientes. Cada **producto** (boards, el backoffice) es un cliente
confidencial: su app web se identifica con un secreto que guarda en su servidor, y se
declara en el código de cooper, como los productos. Cada **cliente MCP** (Claude, el MCP
inspector) es un cliente público que se registra solo, y se identifica únicamente con
PKCE.

newt no tiene un servidor OAuth, y no lo necesita: OAuth es un protocolo, y su código es
de cooper. Lo que da newt es el HTTP que lo rodea, y eso es lo que este capítulo enseña
por completo: un segundo router en la raíz, un formato de error propio de OAuth, rutas a
las que pueden llamar páginas de otros orígenes, y una forma de servir ambos routers en un
puerto. Los módulos que van junto a ellos guardan secretos, se escriben entre sí una vez,
y revocan lo que se copió desde un worker: todo newt que ya conoces, usado en un sitio
nuevo. El código del protocolo (tres módulos, unas 1.300 líneas) lo copias del
repositorio, y este capítulo recorre su forma.

Todavía no hay UI. Las páginas de auth, `/authorize/:id` y `/error`, llegan con los
frontends en el capítulo [23](./23-frontends); aquí las interpretas tú con `curl`. boards
se convierte en cliente de auth en el capítulo [22](./22-web-session).

Al final tendrás estos archivos:

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

## Su configuración

auth necesita saber tres cosas nuevas: dónde se abre (la dirección que nombra en cada
enlace que da a los clientes), el secreto del cliente de cada producto, y cuánto duran los
tokens. En `config.ts`, añade la URL pública de auth a `publicUrls`, y los secretos
después:

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
 * Each is kept under the id of the product it signs people in to, its client_id, as
 * auth looks it up; its variable is named after the app, as the people deploying it
 * know it: boards' is `COOPER_BOARDS_CLIENT_SECRET`, for the product `cooper`.
 */
const clientSecrets = {
  cooper: env.COOPER_BOARDS_CLIENT_SECRET ?? 'cooper-dev-boards-client-secret',
  backoffice: env.COOPER_BACKOFFICE_CLIENT_SECRET ?? 'cooper-dev-backoffice-client-secret',
}
```

Sus claves son los ids de los productos, el `client_id` de cada uno, que es como auth busca
un secreto. Sus variables llevan el nombre de las apps, como las conoce quien las despliega:
el secreto de boards es `COOPER_BOARDS_CLIENT_SECRET`, guardado bajo `cooper`.

y la parte de auth queda así:

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

La URL pública de auth no es su puerto. En desarrollo, el 5171 es el frontend de auth
(capítulo 23), cuyo servidor de desarrollo reenvía `/api`, `/oauth` y `/.well-known` al
3001: el navegador ve un solo origen para las páginas de auth y sus endpoints, así que la
cookie de auth se envía a ambos. En producción es el dominio propio de auth. Los secretos
tienen valores por defecto para desarrollo; producción los fija, y cada app conoce solo el
suyo. La clave `cooper` es el id de producto de boards, así que su variable es
`COOPER_BOARDS_CLIENT_SECRET`.

## Un segundo router, en la raíz

La API de auth vive bajo `/api`, responde `{ error, code }`, y toda ruta necesita una
sesión salvo que diga otra cosa. Los endpoints de OAuth son distintos en los tres
aspectos. Sus direcciones las fijan el protocolo y sus clientes (`/oauth/token`,
`/.well-known/oauth-authorization-server`), no están bajo `/api`. Responden los errores en
el formato propio de OAuth, `{ error, error_description }`. Y ninguno necesita una sesión:
un cliente se identifica por sí mismo, con un secreto o con un verificador PKCE, y el
navegador que llega a `/oauth/authorize` puede no haber iniciado sesión todavía.

Así que tienen un router propio. La base de auth lo gana:

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

**`new HttpRouter({ prefix: '', public: true })`.** Las opciones de un router son los
valores por defecto de cada una de sus rutas, más el sitio donde van:

- **`prefix: ''`** lo monta en la raíz. Un router bajo `/api` responde un 404 a cualquier
  ruta bajo `/api` para la que no tenga ruta; uno en la raíz solo toma las rutas que
  tiene, y deja cualquier otra dirección a lo que venga después (el frontend, en el
  capítulo 23). Así `/oauth/token` es de este router, y `/authorize/123` no.
- **`public: true`** es el `{ public: true }` de cada ruta, dicho una sola vez: ninguna de
  estas rutas pregunta al autenticador quién llama, y ninguna se ejecuta como un actor. Una
  ruta que necesita saber quién ha iniciado sesión en auth lee ella misma la cookie, como
  verás.

Cada ruta puede decir otra cosa por sí misma: las opciones de la ruta van primero.

El router está en la base porque los módulos registran ahí sus rutas, como hacen en
`base.http`: los módulos de OAuth añaden las suyas a `base.oauth`.

## Servir los dos: `routes()`

`serve` toma un router, la API del contexto. Todo lo demás va en su opción `routes`, como
`Bun.serve` toma rutas: el `routes()` de otro router, un webhook. Todo contexto servido de
cooper tiene un sitio donde añadirlas, `routes()`, vacío salvo que diga otra cosa:

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

auth lo sobrescribe más abajo. boards también lo hará, para su entrada MCP, en el
capítulo 24.

## Abierto a otros orígenes: `cors`

Un cliente MCP puede ejecutarse en un navegador: el MCP inspector es una página web en su
propio origen. Lee los metadatos de auth, se registra y cambia su código desde ahí. Un
navegador deja que una página llame a otro origen solo si ese origen lo dice (CORS). Las
rutas de newt lo dicen con la opción `cors`, que es un valor que cooper guarda en un solo
sitio:

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

`Cors` es el tipo de newt. `origin` es `'*'` o una lista de orígenes; `headers` son lo que
la página puede enviar además de las cabeceras simples; `expose`, lo que puede leer de la
respuesta además de las simples. Una ruta con `cors` responde ella misma al preflight
(`OPTIONS`) del navegador, y añade las cabeceras a cada respuesta, también a sus errores.
Un `maxAge` diría cuánto tiempo guarda el navegador la respuesta al preflight; un día si
no se indica.

Nunca va con cookies: newt no envía `Access-Control-Allow-Credentials`. Por eso `'*'` es
seguro aquí. Una página de otro origen no puede aprovecharse de la cookie de auth de
alguien; quién es viaja en un token bearer, que tiene que haberle sido dado. Las
cabeceras MCP están en la lista porque el servidor MCP de boards usa el mismo valor en el
capítulo 24.

## Dónde está todo: los metadatos

Un cliente que solo sabe dónde está auth encuentra el resto en un documento (RFC 8414):

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

La primera ruta en `base.oauth`. Es pública (lo dice el router) y está abierta a cualquier
origen (`cors`). Las direcciones son las de `publicUrl`, la dirección donde los clientes
llegan a auth, nunca el puerto en el que escucha.

## Los productos se vuelven clientes

Cada producto es un cliente OAuth cuyo `client_id` es el id del producto. auth necesita
saber, de cada uno, quién puede entrar, si tiene un servidor MCP, y a dónde van sus
códigos. `product.schema.ts` gana un esquema para lo primero y tres campos:

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
  /** Who may enter it: anyone with an account (boards), or only those given access to it (the backoffice's staff). */
  access: ProductAccessSchema,
  /** Its MCP server, if it has one: the resource (RFC 8707) the tokens of MCP clients are for. */
  mcpResource: z.url().nullable(),
  /** Where its OAuth client receives the codes it signs people in with. */
  redirectUri: z.url(),
})

export type ProductAccess = z.infer<typeof ProductAccessSchema>
export type ProductDTO = z.infer<typeof ProductSchema>
```

- **`access`**: `anyone` deja entrar a cualquiera con una cuenta (boards: lo que ven
  dentro depende de los workspaces); `granted` solo a quienes tienen un acceso a todo el
  producto (el backoffice: el personal).
- **`mcpResource`**: la dirección del servidor MCP del producto, para la que son los
  tokens de los clientes MCP (el `resource` del RFC 8707). boards tiene uno; el backoffice
  no.
- **`redirectUri`**: donde la app web del producto recibe sus códigos.

Todas las apps web los reciben en la misma ruta, que sirve el helper de sesión web del
capítulo 22. Empieza aquí con esa única constante:

```ts
// cooper/backend/shared/web-session/web-session.schema.ts
/**
 * Where auth sends the browser back with a code: every web app's OAuth redirect URI
 * is its public URL and this path. auth declares each product's client with it.
 */
export const WEB_SESSION_CALLBACK = '/api/session/callback'
```

El módulo de productos gana dos casos de uso. `list`, después del constructor, da todos
los productos, para el módulo de clientes OAuth y para cerrar sesión; el comentario de
`get` ahora nombra al helper de sesión web:

```ts
// cooper/backend/contexts/auth/modules/product/product.module.ts
  @UseCase()
  async list(): Promise<ProductDTO[]> {
    return structuredClone(this.products)
  }

  /** For the web-session helper and other contexts: a product by its id. */
```

y `forResource`, al final, el producto que pide un cliente MCP:

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

`sameResource` va encima de la clase, después de los imports.

## El protocolo: cópialo

Tres módulos y sus tablas son OAuth en sí: clientes, peticiones de autorización y tokens.
Cópialos, con su test, desde la etiqueta del capítulo:

```sh
git checkout tutorial/21 -- \
  cooper/backend/contexts/auth/modules/oauth-client \
  cooper/backend/contexts/auth/modules/oauth-grant \
  cooper/backend/contexts/auth/modules/token \
  'cooper/backend/contexts/auth/migrations/sqlite/0000[789]_*' \
  cooper/backend/contexts/auth/oauth.test.ts
```

Cada módulo tiene la anatomía del capítulo [2](./02-first-module): un esquema, una
entidad, un repositorio sobre una tabla, errores, un módulo de casos de uso y un archivo
de rutas. Lo que es OAuth en ellos (qué campos debe tener una petición, el hash de PKCE,
qué RFC dice qué) puedes leerlo a tu ritmo. Cada repositorio dice `scope: 'none'`, como
los de auth (capítulo [17](./17-auth)): los clientes son de auth, un grant se encuentra
por su código y un token por su hash, en ningún tenant. Lo que sigue es la parte que es
newt.

| Módulo | Qué guarda | Sus rutas |
|---|---|---|
| `oauthClient` | `oauth_client`: el cliente de cada producto, y cada cliente MCP que se registró | `POST /oauth/register` |
| `oauthGrant` | `oauth_grant`: una petición de autorización, la respuesta de la persona, el hash de su código | `GET /oauth/authorize`, `GET /api/authorizations/:id`, `POST …/approve`, `POST …/deny` |
| `token` | `token`: los tokens de acceso y de refresco por los que se cambió una autorización, como hashes | `POST /oauth/token`, `POST /oauth/revoke` |

### Los secretos no salen: un esquema público

El capítulo [17](./17-auth) dio a la entidad de usuario un esquema público, para que el
hash de su contraseña no llegue nunca a una respuesta ni a un evento. Cada una de estas
entidades también guarda un secreto, y hace lo mismo. El cliente de un producto guarda el
hash de su secreto:

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

una autorización, el de su código:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.ts
/** The request as it is kept: what anyone sees, and the hash of the code it gave. */
const OauthGrantEntitySchema = OauthGrantSchema.extend({
  codeHash: z.string().nullable(),
})
```

y un token, los de sus tokens:

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

Cada una pasa su esquema público el último a `super`, así que `toDTO()` da solo lo que
cualquiera puede ver, y el repositorio guarda el resto. Los secretos en sí no se guardan
en ningún sitio. Un código o un token se crea con `SecretToken.generate()`, se entrega una
sola vez (en la redirección, en la respuesta del endpoint de tokens), y solo se guarda el
`SecretToken.hash` de él, como las sesiones del capítulo 17. Cada tipo tiene un prefijo
(`cooper_ac_`, `cooper_at_`, `cooper_rt_`) para que las personas y los escáneres de
secretos lo reconozcan. El secreto de un cliente es un objeto de valor, `ClientSecret`, que
se compara en tiempo constante.

### Los errores de OAuth: `onError` y `toOauthErrorResponse`

Una ruta de `base.http` que lanza un error responde `{ error, code }`, a través de
`toErrorResponse` (capítulo [3](./03-pages-and-errors)). Un cliente OAuth espera `{ error,
error_description }`, con `error` uno de los códigos del protocolo. Cualquier ruta, grupo o
router puede decir cómo se responden sus errores, con `onError`; newt tiene el de OAuth,
`toOauthErrorResponse(error, fallback, codes)`. El registro lo usa:

```ts
// cooper/backend/contexts/auth/modules/oauth-client/oauth-client.routes.ts
import { toOauthErrorResponse } from 'newt/http'
import { z } from 'zod'
import { OPEN_TO_BROWSERS } from '../../../../shared/cors'
import type { AuthBase } from '../../auth-base'
import type { OauthClient_Module } from './oauth-client.module'

/**
 * What RFC 7591 calls the fields this route reads: an object, each field as it came.
 * The use case checks what they say.
 */
const RegistrationRequest = z.object({ client_name: z.unknown(), redirect_uris: z.unknown(), token_endpoint_auth_method: z.unknown() })

export function registerOauthClientRoutes(base: AuthBase, clients: OauthClient_Module): void {
  // Dynamic client registration (RFC 7591), for MCP clients. Public: whoever registers
  // is nobody in cooper yet. It speaks OAuth's wire format, errors included.
  base.oauth.post('/oauth/register', async request => {
    const body = RegistrationRequest.parse(await request.json())
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
      return Response.json({ error: 'invalid_client_metadata', error_description: 'A registered client is public: its token_endpoint_auth_method is none' }, { status: 400, headers: { 'cache-control': 'no-store' } })
    }
    const client = await clients.register({
      name: typeof body.client_name === 'string' ? body.client_name : undefined,
      redirectUris: body.redirect_uris,
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

- La ruta lee el cuerpo con el snake_case del RFC 7591 y le pasa al caso de uso los
  nombres de cooper. `RegistrationRequest` es un esquema de zod que solo pide un objeto,
  cada campo tal como llegó (`z.unknown()`): un cuerpo que no es un objeto (una lista, un
  string) es un 400 `invalid_client_metadata`, no un fallo. Lo que esté mal en los
  campos, una dirección de redirección en otro sitio, por ejemplo, lo encuentra el
  esquema de `register`: recibe `input: unknown` y lo parsea, como todo caso de uso al
  que llega una ruta.
- **`onError`** recibe todo error que lanza la ruta. `toOauthErrorResponse` responde un
  `DomainError` con su propio estado y mensaje, y un error de zod o un cuerpo que no es
  JSON con un 400; cada uno con `error` puesto a `fallback`, aquí
  `invalid_client_metadata`, salvo que `codes` nombre otro para el código de ese error.
  Cualquier otra cosa es un 500, `server_error`, registrado en el log, sin decir nada del
  interior. Toda respuesta lleva `cache-control: no-store`, como pide OAuth.
- **`cors`** en la ruta deja que el MCP inspector se registre desde su página.

El endpoint de tokens tiene más errores que distinguir, así que los mapea. Sus dos rutas
comparten opciones, un valor `RouteOptions`:

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

`OAUTH_ERRORS` mapea los códigos de error de cooper a los de OAuth: un cliente desconocido
o un secreto incorrecto es `invalid_client` (con el 401 de `InvalidClient`), un código o
un token de refresco que no sirve es `invalid_grant`. Todo lo demás que sea culpa de la
petición es `invalid_request`. El formulario también se lee en bruto (`request.text()`):
OAuth envía `application/x-www-form-urlencoded`, y las credenciales del cliente pueden
llegar en la cabecera `Authorization`.

`onError` decide el cuerpo de todo error que lanza una ruta, y también el de un 405. Un
método que una dirección no tiene es un error de esa dirección, así que newt lo responde
con el `onError` de la primera ruta registrada en ella, sea cual sea su método. Todas las
rutas de `/oauth/token` son del router oauth, así que `GET /oauth/token` recibe un 405 en
el formato de OAuth, con `Allow: POST` y `Cache-Control: no-store`:

```json
{"error":"invalid_request","error_description":"GET is not allowed on /oauth/token"}
```

Una dirección cuya primera ruta es de la API lo respondería en el formato de la API. Una
dirección, un formato.

### Un navegador, no un cliente: el endpoint de autorización

El endpoint de autorización es el que visita el navegador. Sus errores no son para que los
lea un programa: la persona está mirando la pantalla. Y una petición cuyo cliente o
dirección de redirección sea incorrecto no debe enviar nunca el navegador a esa dirección.
Así que su `onError` envía el navegador a la página de error de auth:

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

`onError` toma cualquier función del error (y la petición) a una respuesta: aquí una
redirección para lo que cooper rechaza (un `DomainError`), y la respuesta propia de la
API, `toErrorResponse`, para lo que es un bug. Sin `cors`: el navegador va ahí por sí
mismo, no se llama desde una página.

Las otras tres rutas están en `base.http`, bajo `/api`: son de la UI de auth, no de OAuth.
Aprobar y denegar necesitan una sesión, como cualquier ruta de la API.
`GET /authorizations/:id` es pública, porque la UI muestra quién pregunta antes de que la
persona inicie sesión. Pero si alguien ha iniciado sesión, debe decir de antemano si el
producto le dejará entrar. Una ruta pública se ejecuta como nadie, así que la ruta
pregunta ella misma al módulo de sesiones (`session.authenticate`, el caso de uso del
autenticador del capítulo 17) y, si la cookie es una sesión, ejecuta el caso de uso como
ese actor con `runAsActor`.

### Quién ha iniciado sesión, si alguien: `findCurrentActor`

El caso de uso pregunta entonces como quién se ejecuta, sin exigir a nadie:

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

`currentActor()` lanza `NoActor`, un 401, fuera de cualquier actor: lo correcto para
`approve`, que nadie puede hacer sin iniciar sesión. `findCurrentActor()` devuelve
`undefined` en su lugar: para lo que cualquiera puede ver, y quien ha iniciado sesión ve
más. Úsalo solo ahí; un caso de uso que necesita a alguien usa `currentActor()`, y el 401
llega solo.

### Un código se gasta una vez: `writesTo` y `retryOnConflict`

El cliente cambia su código en el endpoint de tokens, que llama a `token.exchange`. Ese
caso de uso gasta el código, en el módulo de autorizaciones, y luego guarda los tokens, en
el suyo:

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

Son las dos opciones del `tenant.create` del capítulo [18](./18-tenants-and-access), por
motivos propios:

- **`writesTo: ['oauthGrant']`.** `redeem` guarda la autorización, una escritura en otro
  módulo fuera de un worker. El cliente espera sus tokens en esta misma respuesta; un
  worker no se los daría a nadie. Si guardar los tokens falla después de gastar el código,
  el código se ha perdido y el cliente empieza de nuevo: no queda nada a medias que vea una
  persona.
- **`retryOnConflict: false`.** Un conflicto al guardar el token ejecutaría `exchange` de
  nuevo desde el principio, y `redeem` encontraría su propio código gastado. Para el
  módulo de autorizaciones eso parece exactamente un código copiado, y revocaría lo que
  dio. Así que la cadena no se vuelve a ejecutar nunca.

### Un código copiado se revoca, desde un worker

Un código presentado una segunda vez, después de cambiarse, fue copiado (RFC 6749
§4.1.2): los tokens que dio deben dejar de funcionar. `redeem` lo ve y marca la
autorización:

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

La entidad cuenta lo ocurrido con un evento:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.ts
  replay(): void {
    this.change({ status: 'replayed' })
    this.trackEvent(new OauthGrant_Replayed(this.toDTO()))
  }
```

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/events/oauth-grant-replayed.ts
import { now, type DomainEvent } from 'newt/core'
import type { OauthGrantDTO } from '../oauth-grant.schema'

/** A code was brought again after it was traded: the tokens it gave are to be revoked. */
export class OauthGrant_Replayed implements DomainEvent<OauthGrantDTO> {
  static readonly eventName = 'oauthGrant.replayed'
  readonly name = OauthGrant_Replayed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: OauthGrantDTO) {}
}
```

Los tokens son del módulo de tokens, y el módulo de autorizaciones no debe escribirlos.
Así que el módulo ofrece el evento, como hizo el del capítulo [10](./10-events):

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.module.ts
  readonly events

  private constructor(base: AuthBase, private readonly repo: OauthGrant_Repository, private readonly deps: OauthGrant_Deps) {
    super('oauthGrant', base.invocations)
    this.events = eventsOf(base.bus, { replayed: OauthGrant_Replayed })
  }
```

y el módulo de tokens suscribe un worker a él:

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

El job se escribe en la misma transacción que el `replayed` de la autorización, y luego
`revokeGrant` borra la fila del token. Puede ejecutarse más de una vez, y la segunda no
encuentra nada. Quien lo lanzó recibe su `invalid_grant` al instante; los tokens dejan de
funcionar un momento después. Fíjate en lo que no ocurre: `redeem` lanza el error después
de guardar. Su guardado es suyo, confirmado, y el error solo avisa a quien llama; el job
ya está en el outbox.

Un token de refresco presentado de nuevo después de haber sido reemplazado es la misma
historia dentro de un solo módulo: `token.refresh` lo encuentra como un
`previousRefreshTokenHash` y revoca esa fila él mismo.

## Cerrar sesión desde una app

Cuando alguien cierra sesión en boards (capítulo 22), la sesión propia de boards termina.
Pero la sesión de auth seguiría ahí, e iniciar sesión otra vez no preguntaría quién es.
Así que una app envía el navegador al `/oauth/logout` de auth al salir. auth termina su
sesión y devuelve el navegador a donde pidió la app, si es uno de los productos de cooper:
nunca a una dirección de la que nadie responde. El módulo de sesiones gana
`returnAddress`, después de `signOut`:

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

y su archivo de rutas, una ruta, al final, en el router oauth:

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

Actualiza también el comentario del módulo:

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
/**
 * Who is signed in to auth itself: signing up, in and out, and who sends each request
 * to auth's API. One session here signs the person in to every product: each product
 * opens a session of its own from it, through OAuth.
 */
```

## Conectarlo

Los tres módulos van después de los que usan. La entrada de cada producto en
`declaredProducts` gana su acceso, su servidor MCP y dónde llegan sus códigos:

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

El módulo de autorizaciones recibe `publicUrl` para enviar el navegador a las páginas de
auth; el módulo de tokens, sus duraciones, `config.oauth` tal cual.

El contexto registra los metadatos, mantiene el cliente de cada producto al día con el
código y la configuración, y sirve el router oauth junto a su API:

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

- **`declareProducts`** es un caso de uso del módulo de clientes, que se ejecuta en cada
  arranque. La primera vez crea el cliente de cada producto; después actualiza su nombre,
  su dirección de redirección y el hash de su secreto según lo que dicen ahora el código y
  la configuración. Un secreto cambiado en producción surte efecto en el siguiente
  arranque. Los productos son código (capítulo 17); sus clientes son filas solo porque lo
  son los de los clientes MCP, y el endpoint de tokens encuentra a ambos de la misma
  forma.
- **`routes()`** es la sobrescritura: las rutas de la API, de `super`, y las del router
  oauth. `serve` las pone en una sola tabla para `Bun.serve`. El constructor ahora guarda
  la base (`private readonly auth`) para llegar a `auth.oauth`.

## Sus tests

El test que copiaste, `oauth.test.ts`, arranca auth en un puerto libre y lo maneja por
HTTP, como harían un cliente y un navegador:

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

`freePort` y `browser` vienen de `newt/testing`: un puerto en el que nadie escucha, y un
`fetch` que conserva las cookies entre llamadas y no sigue las redirecciones, para que un
test pueda iniciar sesión y luego mirar a dónde lo envía auth. El capítulo 22 los usa para
la sesión web de boards y cuenta más. La `publicUrl` del test es el propio servidor, así
que las direcciones de los metadatos y las redirecciones apuntan a él.

Sus nueve tests cubren los metadatos; una vuelta completa (registrar, autorizar, revisar
antes de iniciar sesión, registrarse, aprobar, cambiar, verificar, refrescar, revocar); un
token de refresco repetido; un código repetido, cuyos tokens se revocan después de que
`auth.base.jobs.idle()` ejecute el worker; un verificador PKCE incorrecto, un tipo de
autorización desconocido, un cliente desconocido y un challenge `plain`, que van a la
página de error; una persona que dice que no; cerrar sesión de camino de vuelta a un
producto y a ninguna otra dirección; y el cliente confidencial del backoffice, que deja
entrar solo al personal con acceso y rechaza un secreto incorrecto. Uno más pide el
endpoint de tokens con `GET`, y el de registro con `DELETE`: un 405, en el formato de
OAuth.

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 112 pass
 0 fail
```

Los tests de OAuth por sí solos:

```sh
bun test cooper/backend/contexts/auth/oauth.test.ts
```

```text
 9 pass
 0 fail
 65 expect() calls
Ran 9 tests across 1 file.
```

Luego a mano. Arranca el backend (`bun cooper/backend/index.ts`). auth aplica sus tres
migraciones nuevas y declara los clientes de los dos productos. Desde otra terminal, pide
los metadatos:

```sh
curl -s localhost:3001/.well-known/oauth-authorization-server
```

```text
{"issuer":"http://localhost:5171","authorization_endpoint":"http://localhost:5171/oauth/authorize","token_endpoint":"http://localhost:5171/oauth/token","registration_endpoint":"http://localhost:5171/oauth/register","revocation_endpoint":"http://localhost:5171/oauth/revoke","response_types_supported":["code"],"grant_types_supported":["authorization_code","refresh_token"],"code_challenge_methods_supported":["S256"],"token_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none"],"revocation_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none"]}
```

Todas las direcciones son la URL pública de auth, 5171, no el puerto al que has pedido.
Pregunta como lo haría la página del MCP inspector antes de registrarse, con un preflight
desde otro origen:

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

Registra un cliente:

```sh
curl -s -X POST localhost:3001/oauth/register -H 'content-type: application/json' \
  -d '{"client_name":"My MCP client","redirect_uris":["http://localhost:9999/cb"]}'
```

```text
{"client_id":"01a17968-6d36-767e-b5e4-3d4def06dbed","client_id_issued_at":1793038249,"client_name":"My MCP client","redirect_uris":["http://localhost:9999/cb"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}
```

y uno que recibiría sus códigos en otro sitio, en el formato de OAuth:

```sh
curl -s -X POST localhost:3001/oauth/register -H 'content-type: application/json' \
  -d '{"redirect_uris":["http://evil.example/cb"]}'
```

```text
{"error":"invalid_client_metadata","error_description":"A redirect address is https, or http on localhost"}
```

Ahora sé el cliente. Guarda su id, y haz un par PKCE: un verificador aleatorio, y el
base64url de su SHA-256:

```sh
CID=01a17968-6d36-767e-b5e4-3d4def06dbed   # el tuyo
VERIFIER=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')
curl -si "localhost:3001/oauth/authorize?response_type=code&client_id=$CID&redirect_uri=http://localhost:9999/cb&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz"
```

```text
HTTP/1.1 302 Found
Location: http://localhost:5171/authorize/01a17968-6d57-7655-93cb-7bc4198b3538
…
```

La petición se guarda, y el navegador seguiría a la página de auth para ella. El cliente
no nombró ningún `resource`, así que la petición es para el único producto con un servidor
MCP, boards. La misma petición con `code_challenge_method=plain` va a la página de error:

```text
HTTP/1.1 302 Found
Location: http://localhost:5171/error?message=The+application+does+not+protect+its+request+with+PKCE+%28S256%29
```

Sé la página de auth. Lee la petición, intenta aprobarla sin haber iniciado sesión,
regístrate con un archivo de cookies, y apruébala:

```sh
ID=01a17968-6d57-7655-93cb-7bc4198b3538   # el tuyo
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

El navegador volvería al cliente con un código y su `state`. Sé de nuevo el cliente, y
cambia el código:

```sh
CODE=cooper_ac_T2cOd7_f1NJKqg9Q2LBvyhU-WfD5M6_XY3dFHbvlIg8   # el tuyo
curl -s localhost:3001/oauth/token -d grant_type=authorization_code -d code=$CODE \
  -d code_verifier=$VERIFIER -d client_id=$CID -d redirect_uri=http://localhost:9999/cb
```

```text
{"access_token":"cooper_at_oAgwrni6QvFasjpqX-5ZIlR-3xd82wz-_K8lnTuQugs","token_type":"Bearer","expires_in":3600,"refresh_token":"cooper_rt_OQ4xJ7z9vadkh99xgfOGTH4e3wQQ83XSOB_xrq4lp2A"}
```

Envía la misma petición otra vez, como haría alguien que copió el código:

```text
HTTP/1.1 400 Bad Request
Cache-Control: no-store
Content-Type: application/json;charset=utf-8
Access-Control-Allow-Origin: *
…

{"error":"invalid_grant","error_description":"The code is not valid any more: start signing in again"}
```

y mira la base de datos de auth:

```sh
sqlite3 data/cooper-auth.db 'select status from oauth_grant; select count(*) from token'
```

```text
replayed
0
```

La autorización está `replayed`, y el worker ha borrado los tokens que dio: el token de
acceso de arriba ya no abre nada. Un secreto incorrecto para el cliente del backoffice, y
un tipo de autorización que cooper no da:

```sh
curl -s localhost:3001/oauth/token -u backoffice:wrong -d grant_type=authorization_code -d code=x -d code_verifier=y -d redirect_uri=z
curl -s localhost:3001/oauth/token -d grant_type=password -d client_id=$CID
```

```text
{"error":"invalid_client","error_description":"The client is unknown, or did not prove it is who it says"}
{"error":"unsupported_grant_type","error_description":"cooper gives tokens for a code or a refresh token"}
```

Por último, cierra sesión en auth de camino de vuelta a boards, y luego intenta ir a otro
sitio:

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

## Qué recordar

- Las direcciones con un formato propio (las de OAuth, `/.well-known`, más adelante MCP)
  son un router en la raíz: `new HttpRouter({ prefix: '' })`. Solo toma sus rutas. Sus
  opciones son los valores por defecto de cada ruta, `public: true` entre ellos. Un
  contexto lo sirve junto a su API mediante el `routes` de `serve`, que los contextos de
  cooper rellenan sobrescribiendo `routes()`.
- Una ruta responde sus errores a su manera con `onError`. Los endpoints de OAuth usan
  `toOauthErrorResponse(error, fallback, codes)`: `{ error, error_description }`, el
  estado del error de dominio, y `codes` mapea los códigos de error de cooper a los de
  OAuth. Una página que visita el navegador puede redirigir en su lugar, nunca a una
  dirección de la que nadie responde.
- Una ruta a la que llaman páginas de otros orígenes lo dice con `cors`. Nunca con
  cookies: lo que una página así demuestra, lo demuestra con un token.
- Una ruta pública se ejecuta como nadie. Para mostrar más a quien ha iniciado sesión,
  lee ella misma la sesión y usa `runAsActor`; el caso de uso pregunta
  `findCurrentActor()`, que devuelve `undefined` en lugar de lanzar un error.
- Los secretos son hashes detrás de un esquema público. Algo que debe ocurrir una vez (un
  código gastado) dice `retryOnConflict: false`; lo que la petición debe dar al instante
  es `writesTo`; lo que se sigue de ello en otro módulo (revocar tokens copiados) es un
  evento y un worker.

Siguiente: [Iniciar sesión en boards: la sesión web](./22-web-session).
