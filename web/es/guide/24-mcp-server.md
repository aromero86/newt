# Un servidor MCP

Ana guarda el trabajo de su equipo en cooper. También habla todo el día con un asistente
de IA, como Claude. Le gustaría decirle "pon una tarjeta en Launch para el dossier de
prensa y dásela a Bob" y que se haga, en su nombre, con las mismas reglas que cuando
hace clic.

El asistente habla **MCP**, el Model Context Protocol: llama por HTTP a las *herramientas*
(tools) que ofrece un servidor. Este capítulo da a boards un servidor MCP en `/mcp`. Tres
preguntas lo dan forma:

- **¿Quién llama?** No un navegador con una cookie. El asistente trae un token de acceso
  que auth le dio por OAuth, para este servidor ([capítulo 21](./21-oauth-server)). boards
  pregunta a auth de quién es el token, en cada petición.
- **¿Cómo sabe dónde iniciar sesión un asistente que solo conoce `/mcp`?** El 401 que
  recibe sin token nombra un pequeño documento JSON, los *metadatos del recurso
  protegido*, que nombra a auth.
- **¿Qué puede hacer?** Exactamente lo que puede su persona, y nada más. Cada herramienta
  llama a los mismos casos de uso que las rutas de boards, en un workspace al que se
  comprueba que la persona pertenece. El actor dice que el cambio llegó `via: 'mcp'`, así
  que la actividad de una tarjeta distingue los clics de Ana de los de su asistente.

El protocolo en sí es de `@modelcontextprotocol/sdk`. Lo que da newt es el resto: un
segundo router en la raíz, un autenticador para tokens bearer, y el `onError` propio de
una ruta.

## El SDK

Añade el SDK de MCP, en la versión que usa cooper:

```sh
bun add --exact @modelcontextprotocol/sdk@1.30.1
```

Habla el protocolo en los dos sentidos: `McpServer` y un transporte para boards, y un
`Client` que el test de extremo a extremo usa como lo haría un asistente.

## Los metadatos del recurso protegido

Un cliente MCP empieza conociendo una sola dirección, `http://localhost:5172/mcp`. El
resto lo encuentra en tres pasos:

1. Llama a `/mcp` sin token. La respuesta es un **401** cuya cabecera `WWW-Authenticate`
   nombra los **metadatos del recurso protegido** (RFC 9728).
2. Esos metadatos nombran a auth como **servidor de autorización**.
3. Los metadatos propios de auth (RFC 8414, el `/.well-known/oauth-authorization-server`
   del capítulo 21) dicen dónde registrarse, a dónde enviar a la persona y cómo obtener
   tokens.

El paso 2 es un documento JSON sin más. Crea una carpeta `mcp` en boards para el servidor
MCP, y en ella:

```ts
// cooper/backend/contexts/boards/mcp/protected-resource.ts
import type { HttpRouter } from 'newt/http'

/**
 * How an MCP client that only knows the MCP server's address finds out how to sign in
 * (MCP authorization): the protected resource metadata (RFC 9728) names auth as its
 * authorization server, and auth's own metadata (RFC 8414) says the rest.
 */
export function registerProtectedResource(router: HttpRouter, resource: string, authPublicUrl: string): void {
  const metadata = {
    resource,
    authorization_servers: [authPublicUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'Cooper',
  }
  const answer = () => Response.json(metadata)
  // At the root and at the path of the resource: clients look in either (RFC 9728 §3.1).
  router.get('/.well-known/oauth-protected-resource', answer, { public: true })
  router.get('/.well-known/oauth-protected-resource/mcp', answer, { public: true })
}

/** Where a 401 of the MCP server sends a client to find out how to sign in. */
export function resourceMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/.well-known/oauth-protected-resource/mcp`
}
```

`resource` es la dirección para la que son los tokens: la URL pública de boards más
`/mcp`. auth ya conoce esa misma dirección, como el `mcpResource` del producto `cooper`
(capítulo 21), y la escribe en todo token que da a un cliente MCP que la pidió. Las rutas
son `public`: quien quiere iniciar sesión todavía no tiene token.

`resourceMetadataUrl` es adonde el 401 envía a un cliente. Es una función aparte porque el
401 y las rutas tienen que coincidir en ella.

## El servidor MCP

Ahora el servidor en sí. El archivo es corto, pero cada parte es una pieza de newt que
conoces aquí por primera vez, o en un sitio nuevo:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { bearerAuthenticator, HttpRouter, NotSignedIn, toErrorResponse } from 'newt/http'
import { OPEN_TO_BROWSERS } from '../../../shared/cors'
import type { Boards_Auth, Boards_Modules } from '../initialize-modules'
import { registerMcpTools } from './mcp-tools'
import { registerProtectedResource, resourceMetadataUrl } from './protected-resource'

export type McpOptions = {
  /** Where people open boards: the MCP server is at its `/mcp`, the resource its tokens are for. */
  publicUrl: string
  /** auth, the authorization server the MCP clients sign in with. */
  authPublicUrl: string
}

const INSTRUCTIONS = [
  'Cooper keeps boards of cards, like Trello, in workspaces.',
  'Start with list_workspaces: every other tool takes a workspace id. A board has columns (its cards\' statuses) and cards;',
  'get_board shows them all, and the members a card can be assigned to.',
].join(' ')

/**
 * boards' MCP server, at `/mcp` (Streamable HTTP), and the metadata that says how to
 * sign in to it, for AI assistants (Claude, the MCP inspector…): a router at the root
 * of its own. It acts for the person whose access token the assistant brings: one
 * auth gave for this server through OAuth (`auth.token.verify`, with this server as
 * its resource). Like the routes, the tools only call use cases.
 *
 * It keeps no session: each request is a server of its own, answered in JSON. Nothing
 * here sends a client anything it did not ask for, so there is no stream to keep open:
 * GET, which would open one, and DELETE, which would end a session, are a 405.
 *
 * Open to pages of any origin, such as the MCP inspector's: who calls is in the token,
 * never in a cookie.
 */
export function mcpRoutes(modules: Boards_Modules, auth: Pick<Boards_Auth, 'token'>, options: McpOptions): Bun.Serve.Routes<undefined, string> {
  const resource = `${options.publicUrl}/mcp`
  const router = new HttpRouter({ prefix: '', cors: OPEN_TO_BROWSERS })
  // A token of auth's for this server only: not one for another server, nor a web app's.
  router.authenticateWith(bearerAuthenticator(async accessToken => {
    const identity = await auth.token.verify(accessToken)
    return identity?.resource === resource ? { userId: identity.userId, via: 'mcp' } : null
  }))

  router.post('/mcp', async request => {
    const server = new McpServer({ name: 'cooper', version: '1.0.0' }, { instructions: INSTRUCTIONS })
    registerMcpTools(server, modules)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(request)
    } finally {
      await server.close()
    }
  }, {
    // Without a token, or with one that is not valid: where to get one.
    onError: (error, request) => error instanceof NotSignedIn
      ? Response.json(
        { error: 'An access token for this MCP server is needed: connect through OAuth' },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(options.publicUrl)}"${request.headers.has('authorization') ? ', error="invalid_token"' : ''}` } },
      )
      : toErrorResponse(error),
  })

  registerProtectedResource(router, resource, options.authPublicUrl)
  return router.routes()
}
```

Vamos por partes, desde arriba.

### Un segundo router en la raíz

La API de boards es `base.http`, un router bajo `/api` cuyo autenticador lee la cookie de
la sesión web (capítulo 22). El servidor MCP no está bajo `/api`, y no usa la cookie. Así
que tiene un router propio:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
// …
  const router = new HttpRouter({ prefix: '', cors: OPEN_TO_BROWSERS })
// …
```

Ya lo viste en el capítulo 21, donde auth sirve desde uno sus endpoints de OAuth. `prefix:
''` monta el router en la raíz, junto al frontend: toma solo las rutas que registra
(`/mcp` y las dos `/.well-known/…`), y cualquier otra dirección sigue siendo del
frontend. Las opciones que se dan al router son los valores por defecto de cada ruta, así
que `cors: OPEN_TO_BROWSERS` (el `shared/cors.ts` del capítulo 21) abre las tres a páginas
de cualquier origen. Algunos clientes MCP se ejecutan en un navegador: el MCP inspector
averigua cómo iniciar sesión, y llama a `/mcp`, desde una página de su propio origen. Es
seguro aquí por la misma razón que en los endpoints de auth: nada en este router lee una
cookie, así que una página de otro origen no tiene nada de la persona que tomar prestado.
Quién llama está en el token bearer.

`router.routes()` al final es la tabla que se le da a Bun, como en cualquier router. Un
método que una ruta no tiene es un 405: el servidor solo responde a `POST /mcp`, así que
`GET /mcp` (que abriría un flujo de mensajes que el servidor envía sin que se los pidan) y
`DELETE /mcp` (que terminaría una sesión) se rechazan, y un `OPTIONS` desde otro origen
recibe su preflight.

### `bearerAuthenticator`

A diferencia del router OAuth de auth, este no es público: toda ruta necesita a alguien
con la sesión iniciada, salvo que diga `public` (los metadatos lo dicen). Quién ha
iniciado sesión lo dice su autenticador, que se fija como en cualquier router, con
`authenticateWith`:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
// …
  // A token of auth's for this server only: not one for another server, nor a web app's.
  router.authenticateWith(bearerAuthenticator(async accessToken => {
    const identity = await auth.token.verify(accessToken)
    return identity?.resource === resource ? { userId: identity.userId, via: 'mcp' } : null
  }))
// …
```

`bearerAuthenticator`, de `newt/http`, lee el token de `Authorization: Bearer <token>`
(RFC 6750). Una petición sin él no es de nadie, y tu `verify` no se llama. Con él,
`verify` recibe el token y responde con el actor, o con `null` si el token no es válido.
Eso es todo lo que hace: qué significa un token lo dices tú.

Aquí lo dice auth. `auth.token.verify` es el caso de uso del capítulo 21, llamado en el
mismo proceso: para quién es el token, para qué cliente y qué recurso, o `null` si no abre
nada (desconocido, caducado, revocado). boards lo acepta solo si su `resource` es este
servidor. Un token que auth dio a la app web de boards no tiene recurso, y uno para otro
servidor MCP tiene otro: los dos se rechazan, aunque auth respondería por ellos.

El actor que responde es `{ userId, via: 'mcp' }`. El router ejecuta la ruta como ese
actor (`runAsActor`), así que todo caso de uso que llame una herramienta ve a Ana en
`currentActor()`, exactamente como tras el autenticador de la sesión web, que dice
`via: 'web'`. El capítulo 4 hizo `via` obligatorio en el actor de cooper, con `'mcp'`
entre sus valores; esta es la puerta que se lo da.

`auth` aquí es `Pick<Boards_Auth, 'token'>`: de los casos de uso de auth que recibe boards
(capítulo 20), el servidor MCP necesita uno.

### Un servidor por petición

La ruta construye un `McpServer` nuevo en cada POST, con las herramientas, y un transporte
que responde a esa única petición:

- `sessionIdGenerator: undefined` no guarda ninguna sesión. Nada se recuerda entre
  peticiones: el token dice quién llama, cada vez.
- `enableJsonResponse: true` responde con JSON sin más, no con un flujo. Nada aquí envía al
  cliente nada que no haya pedido, así que no hace falta mantener ningún flujo abierto.

`transport.handleRequest` toma el `Request` estándar de la web y devuelve un `Response`,
que es lo que devuelve una ruta de newt. El `finally` cierra el servidor en cualquier caso.
Es un poco de trabajo por petición, y a cambio es una ruta como cualquier otra: sin estado,
así que cualquier número de procesos puede servirla.

`INSTRUCTIONS` es lo que lee el asistente sobre el servidor al conectarse: qué es cooper, y
por dónde empezar.

### Un 401 que dice dónde iniciar sesión: `onError`

Sin token, o con uno falso, el router lanza `NotSignedIn` antes de ejecutar la ruta. En la
API de boards, `toErrorResponse` lo convierte en el 401 habitual con `{ error, code:
'not_signed_in' }`. Eso no basta para un cliente MCP: la autorización de MCP dice que un
401 debe llevar una cabecera `WWW-Authenticate` que nombre los metadatos del recurso
protegido, o el cliente no puede encontrar a auth.

Una ruta puede decir en qué se convierten sus errores, con su propio `onError`:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
// …
  }, {
    // Without a token, or with one that is not valid: where to get one.
    onError: (error, request) => error instanceof NotSignedIn
      ? Response.json(
        { error: 'An access token for this MCP server is needed: connect through OAuth' },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(options.publicUrl)}"${request.headers.has('authorization') ? ', error="invalid_token"' : ''}` } },
      )
      : toErrorResponse(error),
  })
// …
```

`onError` es un campo de `RouteOptions`, como `public` y `cors`. Recibe lo que haya lanzado
la ruta, y la petición; responde con el `Response`. El `NotSignedIn` de una sesión que
falta pasa también por él, porque la comprobación se ejecuta dentro del manejo de la ruta.
Las rutas OAuth del capítulo 21 lo usan para responder en el formato de OAuth
(`toOauthErrorResponse`); aquí responde a un error a su manera y entrega todos los demás a
`toErrorResponse`, así que el resto queda como en la API.

La cabecera sigue el RFC 6750: `Bearer resource_metadata="…"` cuando no llegó ningún
token, y `error="invalid_token"` añadido cuando llegó uno y se rechazó, para que el
cliente sepa que debe conseguir uno nuevo en vez de iniciar sesión por primera vez. Fíjate
en lo que el 401 no dice: por qué se rechazó un token. Caducado, revocado, para otro
servidor: todo es lo mismo para quien llama.

Los errores de las herramientas no llegan aquí. El SDK captura lo que lanza una
herramienta y responde a la llamada con `isError` y el mensaje del error, que lee el
asistente. Los errores de una ruta son del transporte; los de una herramienta son del
protocolo.

## Las herramientas

Una herramienta es la gemela MCP de una ruta: lee sus argumentos y llama a casos de uso.
No decide nada por sí misma. cooper tiene ocho. Aquí escribes dos, `list_workspaces` y
`create_card`, que muestran todo lo que hacen las demás. Copia el archivo tal como está en
la etiqueta de este capítulo:

```sh
git checkout tutorial/24 -- cooper/backend/contexts/boards/mcp/mcp-tools.ts
```

Luego sigue la lectura. La parte de arriba del archivo guarda lo que comparten todas las
herramientas:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mapPage, type Page, type PageRequest } from 'newt/core'
import { z } from 'zod'
import type { Boards_Modules } from '../initialize-modules'
import type { CardDTO, CardFilterDTO } from '../modules/card/card.schema'
import type { WorkspaceMemberDTO } from '../modules/workspace/workspace.schema'
import { inWorkspace } from '../workspace-scope'

/** Tools that only read. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
/** Tools that create or change, never delete. */
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

const workspaceId = z.string().describe('The workspace\'s id, from list_workspaces')
const pageArgs = {
  cursor: z.string().optional().describe('The nextCursor of the page before, to read the next one'),
  size: z.number().int().min(1).max(100).optional().describe('How many items, 20 by default'),
}

const pageOf = (args: { cursor?: string, size?: number }): PageRequest => ({ size: args.size ?? 20, cursor: args.cursor })

/** A page as a tool answers it: with the cursor of the next one, if there is one. */
function paged<T, R>(page: Page<T>, map: (item: T) => R) {
  const { items, total, nextCursor } = mapPage(page, map)
  return { items, total, nextCursor: nextCursor ?? null }
}

/** What a tool returns: its answer as JSON, for the assistant to read. */
const answer = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

/** A card as the assistant reads it: its assignee by name too. */
function cardOf(card: CardDTO, members: WorkspaceMemberDTO[]) {
  const assignee = members.find(member => member.id === card.assigneeId)
  return {
    id: card.id,
    number: card.number,
    title: card.title,
    description: card.description,
    boardId: card.boardId,
    columnId: card.columnId,
    position: card.position,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
  }
}
// …
```

- Las **anotaciones** dicen al asistente, y a la persona que aprueba sus llamadas, si una
  herramienta solo lee (`readOnlyHint`), si puede destruir algo (`destructiveHint`), o si
  llega fuera de cooper (`openWorldHint`). Ninguna herramienta de boards borra.
- Los **argumentos** son esquemas de zod, con un `describe` que lee el asistente: di de
  dónde sale cada id (`from list_workspaces`). El SDK los valida antes de que se ejecute
  la herramienta.
- **`answer`** es lo que devuelve una herramienta: texto, aquí JSON. `cardOf` da forma a una
  tarjeta para el asistente, con el nombre de su asignado además del id, para que no
  tenga que buscar a Bob para decirle a Ana quién tiene la tarjeta. `paged` convierte una
  `Page` de newt en elementos, un total y el cursor siguiente (`mapPage`, capítulo 3).

Luego, la función que registra las herramientas en un servidor:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
// …
/**
 * boards' tools, for the person whose token the assistant brings. Like the routes,
 * they only call use cases: a tool given a workspace runs in it once the person is
 * checked to belong to it (`inWorkspace`), as a route under `/workspaces/:workspaceId`.
 */
export function registerMcpTools(server: McpServer, modules: Boards_Modules): void {
  const { workspace, board, card, member } = modules
  const within = <T>(id: string, fn: () => Promise<T>) => inWorkspace(member, id, fn)

  server.registerTool('list_workspaces', {
    title: 'List workspaces',
    description: 'The workspaces the person belongs to. Every other tool takes the id of one of them.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => answer((await workspace.mine()).map(({ id, name, isAdmin }) => ({ id, name, isAdmin }))))
// …
```

`list_workspaces` no toma ningún argumento y llama a `workspace.mine`, el caso de uso que
hay detrás de `GET /api/workspaces` (capítulo 20). Es la primera llamada del asistente:
todas las demás herramientas necesitan un id de workspace, y aquí es donde lo consigue. No
se ejecuta en ningún workspace, como su ruta.

`create_card` sí se ejecuta en uno:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
// …
  server.registerTool('create_card', {
    title: 'Create a card',
    description: 'Adds a card at the bottom of a column of a board, assigned to a member of the workspace if given (list_members says who they are).',
    inputSchema: {
      workspaceId,
      boardId: z.string(),
      columnId: z.string().describe('A column of the board, from get_board'),
      title: z.string().describe('Up to 200 characters'),
      description: z.string().optional(),
      assigneeId: z.string().optional().describe('A member\'s id, from list_members'),
    },
    annotations: WRITE,
  }, async ({ workspaceId: id, boardId, ...input }) => within(id, async () =>
    answer(cardOf(await card.create(boardId, input), await workspace.members()))))
// …
```

### `inWorkspace`: la misma comprobación que el grupo de rutas

Una ruta bajo `/api/workspaces/:workspaceId` está en el grupo del capítulo 4: su
middleware comprueba que la persona pertenece al workspace (`member.enter`) y ejecuta la
ruta en su ámbito. Una herramienta no tiene ruta. Recibe el id del workspace como
argumento, así que entra ella misma en el ámbito, con `inWorkspace`, que escribiste en el
capítulo 4 para este momento:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
// …
/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
```

Es **la misma comprobación** que la del grupo. Un workspace en el que Ana no está tampoco
existe para su asistente: `member.enter` lanza `WorkspaceNotFound`, y el asistente lee su
mensaje. Dentro, todo repositorio de boards ve solo las filas de ese workspace. `within`
en `registerMcpTools` es solo `inWorkspace` con el módulo `member` de boards ya puesto.

Luego `card.create(boardId, input)` es exactamente el caso de uso al que llama `POST
/api/workspaces/:workspaceId/boards/:boardId/cards`. Todo lo que construiste para él se
cumple, sin una línea aquí:

- el título tiene hasta 200 caracteres, la columna es una del tablero, y un tablero
  guarda como máximo 500 tarjetas (capítulo 7);
- la tarjeta recibe el siguiente número de su tablero, se creen las que se creen a la vez
  (capítulo 7);
- un asignado debe ser miembro del workspace (capítulo 7), y recibe un email de un worker
  (capítulo 12);
- la tarjeta se indexa para la búsqueda, y se escribe su actividad (capítulos 11 y 16).

La actividad es donde se ve `via`. Los eventos de una tarjeta llevan quién la cambió
(`by`) y cómo (`via`), a partir de `currentActor()` (capítulo 10), y la actividad guarda
las dos cosas. Una tarjeta que crea el asistente de Ana dice "Ana, por MCP", no solo
"Ana". `via` dice cómo entró alguien, nunca qué puede hacer: ningún caso de uso permite ni
rechaza nada por él.

### Las otras seis

El resto del archivo sigue las mismas dos formas. Cada una es una llamada fina a casos de
uso que ya tienes:

| Herramienta | Casos de uso a los que llama |
|---|---|
| `list_workspaces` | `workspace.mine` |
| `list_boards` | `board.list` |
| `get_board` | `workspace.boardView`, `workspace.members` |
| `list_members` | `workspace.members` |
| `search_cards` | `card.search`, `workspace.members` |
| `create_card` | `card.create`, `workspace.members` |
| `move_card` | `card.move`, `workspace.members` |
| `assign_card` | `card.assign` o `card.unassign`, `workspace.members` |

Dales forma según las preguntas que hará un asistente, no según tus rutas. `list_members`
existe porque a un asistente al que le dicen "dale esto a Bob" le hace falta el id de Bob,
y no debería leer un tablero entero para encontrarlo. `search_cards` toma argumentos
simples (`text`, `boardId`, `assigneeId`) y construye él mismo el `CardFilter`: un
asistente los escribe con más fiabilidad que un árbol de filtros.

## Servirlo desde boards

Un contexto sirve más que su API sobrescribiendo `routes()` (el `ServedContext` del
capítulo 21). Su servidor MCP necesita el caso de uso `token` de auth, que boards recibe
al abrirse: guárdalo en el contexto. En `boards.context.ts`, importa `Boards_Auth` y
`mcpRoutes`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
// …
import { initializeModules, type Boards_Auth, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'
import { mcpRoutes } from './mcp/mcp'
// …
```

Dilo en la descripción del contexto, recibe `auth` en el constructor, y pasa `deps.auth`
desde `open`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
// …
/**
 * The SaaS: each workspace's boards, their columns and cards, on the web and through
 * MCP. Its people sign in through `auth`, which also keeps the workspaces and who
 * belongs to each: `boards` asks it through ports it is handed when it opens, and
 * calls its use cases.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config, private readonly auth: Boards_Auth) {
    super('boards', base, config)
  }
// …
    return new Boards_Context(base, modules, config, deps.auth)
  }
// …
```

Y añade la sobrescritura después de `open`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
// …
  /** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
  }
}
```

`publicUrl` y `authPublicUrl` ya son ajustes de boards (capítulos 21 y 22). Actualiza la
descripción de los ajustes de boards en `config.ts` para que coincida:

```ts
// cooper/backend/config.ts
// …
  /** The SaaS: workspaces' boards, columns and cards, on the web and through MCP. */
  boards: {
// …
```

## La URL pública en desarrollo

En desarrollo la gente abre boards en `http://localhost:5172`, su servidor Vite, que envía
la API al puerto de boards, el 3002 (capítulo 23). El recurso para el que son los tokens
es esa URL pública más `/mcp`, así que un cliente MCP debe llegar también a `/mcp` y a los
metadatos por ahí. Añade ambos al proxy del frontend de boards:

```ts
// cooper/frontend/boards/vite.config.ts
import { cooperApp } from '../vite-app'

// The SaaS. Its context serves the API, the MCP server and the OAuth metadata that points to auth.
export default cooperApp({ name: 'boards', port: 5172, proxy: ['/api', '/mcp', '/.well-known'] })
```

El seed te dice dónde está. En `cooper/scripts/seed.ts`, añade una línea a lo que imprime,
después de la de Bob:

```ts
// cooper/scripts/seed.ts
// …
    '  bob@cooper.dev     a member of Acme, who accepted Ana\'s invitation',
    '',
    `  MCP server         ${config.boards.publicUrl}/mcp (OAuth: sign in as Ana or Bob)`,
    '',
  ].join('\n'))
// …
```

Y en `open-test-boards.ts`, `as` ahora también representa a una herramienta. Solo cambia su
comentario:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
// …
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` (or an MCP tool) does. */
// …
```

## El test

El test de extremo a extremo de cooper recibe un `describe('the MCP server')` que conecta
un cliente MCP como lo haría Claude. Casi todo es el baile de OAuth, código de protocolo
como el del capítulo 21: copia el archivo.

```sh
git checkout tutorial/24 -- cooper/backend/cooper.test.ts
```

Su primer test empieza conociendo solo `/mcp`, y sigue el 401:

```ts
// cooper/backend/cooper.test.ts
// …
    // It only knows the MCP server's address: the 401 says where to find the rest.
    const refused = await fetch(boardsUrl('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(refused.status).toBe(401)
    const metadataUrl = refused.headers.get('www-authenticate')!.match(/resource_metadata="([^"]+)"/)![1]!
    const resource = (await (await fetch(metadataUrl)).json()) as { resource: string, authorization_servers: string[] }
    expect(resource).toEqual(expect.objectContaining({ resource: boardsUrl('/mcp'), authorization_servers: [contexts.auth.config.publicUrl] }))
// …
```

Luego registra un cliente en auth, inicia sesión como Ana con PKCE pidiendo este recurso,
cambia el código por un token, y conecta con él el `Client` del SDK. Llama a todas las
herramientas, y comprueba lo que dice la actividad:

```ts
// cooper/backend/cooper.test.ts
// …
      // Its activity says the assistant did it, as Ana.
      await settled()
      const activity = await runAsActor({ userId: ana.id, via: 'web' }, () => inWorkspace(contexts.boards.modules.member, acme.id, () => contexts.boards.modules.activity.listForCard(card.id, { size: 10 })))
      expect(activity.items.map(entry => [entry.kind, entry.actorId, entry.via])).toEqual([
        ['unassigned', ana.id, 'mcp'],
        ['assigned', ana.id, 'mcp'],
        ['moved', ana.id, 'mcp'],
        ['created', ana.id, 'mcp'],
      ])

      // As on the web: a workspace the person is not in does not exist to them.
      const result = (await client.callTool({ name: 'list_boards', arguments: { workspaceId: '01900000-0000-7000-8000-000000000000' } })) as { isError?: boolean, content: { text: string }[] }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('no workspace')
// …
```

El segundo test es la puerta: sin token, con uno falso, y un preflight desde otro origen.

## Compruébalo

La barrera, como al final de todos los capítulos:

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

Solo los tests de MCP:

```sh
bun test cooper/backend/cooper.test.ts -t MCP
```

```text
 2 pass
 4 filtered out
 0 fail
 30 expect() calls
Ran 2 tests across 1 file.
```

Mientras se ejecutan, el registro de actividad de boards imprime la tarjeta que movió el
asistente, con cómo entró al final de la línea:

```text
[boards] #2 "Ship the MCP server" moved from column 01a17967-… to 01a17967-… by 01a17967-… (mcp)
```

Ahora a mano. Arranca el backend:

```sh
bun cooper/backend/index.ts
```

y, en otra terminal, llama a `/mcp` sin token:

```sh
curl -i -X POST http://localhost:3002/mcp
```

```text
HTTP/1.1 401 Unauthorized
Content-Type: application/json;charset=utf-8
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: mcp-session-id, www-authenticate
www-authenticate: Bearer resource_metadata="http://localhost:5172/.well-known/oauth-protected-resource/mcp"

{"error":"An access token for this MCP server is needed: connect through OAuth"}
```

La cabecera nombra los metadatos en la URL **pública** de boards, la del servidor Vite,
aunque llamaste al puerto 3002: esa es la dirección que usan los clientes. Pídelos igual
al puerto de boards:

```sh
curl http://localhost:3002/.well-known/oauth-protected-resource/mcp
```

```json
{"resource":"http://localhost:5172/mcp","authorization_servers":["http://localhost:5171"],"bearer_methods_supported":["header"],"resource_name":"Cooper"}
```

auth, en `http://localhost:5171`, es donde iniciar sesión. Con un token que no lo es, el
401 lo dice:

```sh
curl -i -X POST http://localhost:3002/mcp -H 'authorization: Bearer not-a-token'
```

```text
HTTP/1.1 401 Unauthorized
…
www-authenticate: Bearer resource_metadata="http://localhost:5172/.well-known/oauth-protected-resource/mcp", error="invalid_token"
```

Y un GET, que abriría un flujo que el servidor nunca mantiene, se rechaza antes de pedirle
un token a nadie:

```sh
curl -i http://localhost:3002/mcp
```

```text
HTTP/1.1 405 Method Not Allowed
…
allow: POST

{"error":"GET is not allowed on /mcp","code":"method_not_allowed"}
```

### Conecta un cliente de verdad

Haz el seed de cooper y arráncalo con sus frontends (capítulo 23):

```sh
bun run cooper:seed
bun run cooper
```

Usa la URL pública de boards, `http://localhost:5172/mcp`: los tokens son para esa
dirección.

**Claude Code.** Añade el servidor, y luego autentícate desde dentro de Claude Code con
`/mcp`. Tu navegador abre la página de inicio de sesión de auth. Inicia sesión como
`ana@cooper.dev` con la contraseña del seed, y permite el acceso:

```sh
claude mcp add --transport http cooper http://localhost:5172/mcp
```

**El MCP inspector.** Ejecútalo, elige el transporte Streamable HTTP, escribe
`http://localhost:5172/mcp` y conecta. Pasa por el mismo flujo OAuth desde su página, en
otro origen, y por eso las rutas están abiertas a cualquiera:

```sh
bunx @modelcontextprotocol/inspector
```

Pide los workspaces de Ana, o crea una tarjeta, y míralos aparecer en la UI de boards.

## Qué recordar

- Un servidor MCP es **otra puerta**, como las rutas: sus herramientas llaman a los mismos
  casos de uso, como la persona del token, en un workspace al que se entra con
  `inWorkspace`, la misma comprobación que el grupo de rutas. No añade reglas propias.
- Las direcciones fuera de `/api` reciben **un segundo router en la raíz** (`prefix: ''`),
  servido por la sobrescritura de `routes()` del contexto. Sus opciones son los valores por
  defecto de cada ruta, `cors` incluido.
- **`bearerAuthenticator`** lee el token; qué significa lo dices tú. Verifícalo en el
  mismo proceso con el `token.verify` de auth, y acéptalo solo para este recurso.
- El **`onError`** propio de una ruta decide en qué se convierten sus errores, también el
  `NotSignedIn` de una sesión que falta: aquí un 401 cuyo `WWW-Authenticate` nombra los
  metadatos del recurso protegido, que nombran a auth.
- `via: 'mcp'` dice **cómo** entró alguien, nunca qué puede hacer. Va al registro (eventos,
  actividad), no a las reglas.

Siguiente: [Un tercer contexto que lee de dos](./25-backoffice).
