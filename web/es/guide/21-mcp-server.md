# Un servidor MCP

Un asistente de IA, como Claude, puede trabajar con los tableros de cooper:
listarlos, leer un tablero, crear, mover y asignar tarjetas. Lo hace a través de un
**servidor MCP** que boards sirve en `/mcp`. El asistente actúa **por una persona**,
con un token de acceso que auth le dio por OAuth ([capítulo 20](./20-oauth-server)).

El servidor MCP no añade lógica. Sus herramientas llaman a los mismos casos de uso
que las rutas de boards, como la persona del token, en el mismo ámbito de espacio.
Todo lo que has construido hasta ahora sirve: las reglas, el 404 para un espacio en
el que no estás, los emails desde workers.

## Dónde se sirve

boards sirve `/mcp` y sus metadatos junto a su API. Un contexto añade rutas fuera de
`/api` sobrescribiendo `routes()`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
/** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
protected override routes(): Bun.Serve.Routes<undefined, string> {
  return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
}
```

## Cómo descubre un cliente dónde entrar

Un cliente MCP empieza sabiendo solo la dirección del servidor. Descubre el resto en
tres pasos:

1. Llama a `/mcp` sin token. La respuesta es un **401** cuya cabecera
   `WWW-Authenticate` apunta a los **metadatos del recurso protegido** (RFC 9728).
2. Esos metadatos dicen que el **servidor de autorización** es auth.
3. Los metadatos de auth (RFC 8414) dicen dónde registrarse, autorizar y conseguir
   tokens.

Los metadatos son un documento JSON sin más:

```ts
// cooper/backend/contexts/boards/mcp/protected-resource.ts
export function protectedResourceRoutes(resource: string, authPublicUrl: string): Bun.Serve.Routes<undefined, string> {
  const metadata = {
    resource,
    authorization_servers: [authPublicUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'Cooper',
  }
  const answer = () => Response.json(metadata)
  return {
    // At the root and at the path of the resource: clients look in either (RFC 9728 §3.1).
    '/.well-known/oauth-protected-resource': answer,
    '/.well-known/oauth-protected-resource/mcp': answer,
  }
}

/** Where a 401 of the MCP server sends a client to find out how to sign in. */
export function resourceMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/.well-known/oauth-protected-resource/mcp`
}
```

Luego el cliente se registra en auth, manda a la persona a auth para entrar y dar su
consentimiento, y cambia el código por tokens. Pide tokens para este **recurso**,
`<URL pública de boards>/mcp`: el `mcpResource` del producto `cooper`.

## El token bearer, verificado en el mismo proceso

Cada petición a `/mcp` trae un token de acceso. boards pregunta a auth para quién es,
con `token.verify`, una llamada normal en el mismo proceso. Solo acepta el token si
se dio **para este servidor**: no uno para otro recurso, ni el token de una
aplicación web.

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
export function mcpRoutes(modules: Boards_Modules, auth: Pick<Boards_Auth, 'token'>, options: McpOptions): Bun.Serve.Routes<undefined, string> {
  const resource = `${options.publicUrl}/mcp`
  const unauthorized = (error?: string) => Response.json(
    { error: 'An access token for this MCP server is needed: connect through OAuth' },
    { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(options.publicUrl)}"${error ? `, error="${error}"` : ''}` } },
  )

  const mcp = async (request: Request): Promise<Response> => {
    const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!accessToken) return unauthorized()
    // A token of auth's for this server only: not one for another server, nor a web app's.
    const identity = await auth.token.verify(accessToken)
    if (!identity || identity.resource !== resource) return unauthorized('invalid_token')

    // GET would open a stream for what the server tells unasked, and DELETE end a session: neither is kept.
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })

    const server = new McpServer({ name: 'cooper', version: '1.0.0' }, { instructions: INSTRUCTIONS })
    registerMcpTools(server, modules)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await runAsActor({ userId: identity.userId, via: 'mcp' }, () => transport.handleRequest(request))
    } finally {
      await server.close()
    }
  }

  // Open to pages of any origin, such as the MCP inspector's: who calls is in the token, never in a cookie.
  const open = Object.fromEntries(Object.entries(protectedResourceRoutes(resource, options.authPublicUrl)).map(([path, route]) => [path, openToBrowsers(route as (request: Request) => Response)]))
  return { ...open, '/mcp': openToBrowsers(mcp) }
}
```

Tres cosas que ver:

- **`runAsActor`.** Una vez verificado el token, toda la petición corre como su
  persona. Cada caso de uso que llama una herramienta la ve en `currentActor()`,
  igual que una ruta después del autenticador de la sesión web. El actor dice además
  **por dónde** entró: `via: 'mcp'` aquí, `'web'` con la cookie de sesión.
- **Sin sesión.** Cada petición tiene su propio servidor (`sessionIdGenerator:
  undefined`), que responde en JSON (`enableJsonResponse: true`). Nada se envía al
  cliente sin que lo pida, así que no queda ningún stream abierto. Escala como
  cualquier otra ruta.
- **El SDK hace MCP, newt hace el resto.** `@modelcontextprotocol/sdk` habla el
  protocolo. Quién es la persona, y qué puede hacer, sigue en auth y boards.

## El actor dice por dónde entró

El `Actor` de newt sabe una cosa: el usuario. cooper añade una segunda, una sola vez
para todos los contextos, ampliando el tipo de newt:

```ts
// cooper/backend/shared/actor.ts
/**
 * How someone reached cooper: its web apps, with a session cookie, or an AI assistant
 * through boards' MCP server, with an access token.
 */
export type ActorVia = 'web' | 'mcp'

// …
declare module 'newt/core' {
  interface Actor {
    via: ActorVia
  }
}
```

El campo es obligatorio, así que TypeScript obliga a todo sitio que dice quién actúa
a decir también por dónde: los autenticadores de sesión devuelven `via: 'web'`, el
servidor MCP `via: 'mcp'`. Ninguno puede olvidarlo.

`via` es **quién es alguien, no lo que puede hacer**. Ningún caso de uso permite o
rechaza nada por él: el asistente puede hacer lo que pueda su persona. Sirve para el
registro. Los eventos de una tarjeta llevan quién la cambió (`by`) y por dónde
(`via`), y el registro de actividad de la tarjeta guarda los dos. Así, una tarjeta
que movió Claude dice "Ana, por MCP", no solo "Ana".

## Las herramientas llaman a los mismos casos de uso

Una herramienta es la gemela MCP de una ruta. No comprueba nada por su cuenta, y solo
llama a casos de uso:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
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

  server.registerTool('move_card', {
    title: 'Move a card',
    description: 'Moves a card to a column of its board (its status), at a position from 0 at the top; at the bottom when none is given.',
    inputSchema: { workspaceId, cardId: z.string(), columnId: z.string(), position: z.number().int().min(0).optional() },
    annotations: WRITE,
  }, async ({ workspaceId: id, cardId, ...to }) => within(id, async () =>
    answer(cardOf(await card.move(cardId, to), await workspace.members()))))

  // …
}
```

Una ruta bajo `/api/workspaces/:workspaceId` entra en el ámbito del espacio en el
middleware de su grupo. Una herramienta recibe el id del espacio como argumento, así
que entra en el ámbito con `inWorkspace`, que hace **la misma comprobación**:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
```

Así una herramienta no puede llegar a un espacio en el que la persona no está, y cada
repositorio por debajo solo ve las filas de ese espacio
([capítulo 5](./05-who-and-where)).

Las herramientas son:

| Herramienta | Casos de uso que llama |
|---|---|
| `list_workspaces` | `workspace.mine` |
| `list_boards` | `board.list` |
| `get_board` | `workspace.boardView`, `workspace.members` |
| `list_members` | `workspace.members` |
| `search_cards` | `card.search`, `workspace.members` |
| `create_card` | `card.create` |
| `move_card` | `card.move` |
| `assign_card` | `card.assign` o `card.unassign` |

`list_members` existe por el asistente. Para asignar una tarjeta necesita el id de
un miembro. `get_board` también lista los miembros, pero a un asistente al que le
piden "dale esto a Bob" no debería tocarle leer un tablero entero para encontrar a
Bob. Una herramienta por cada pregunta que va a hacer el asistente:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
server.registerTool('list_members', {
  title: 'List members',
  description: 'Who belongs to a workspace, its admin first: whom its cards can be assigned to, those with no card too.',
  inputSchema: { workspaceId },
  annotations: READ_ONLY,
}, async args => within(args.workspaceId, async () =>
  answer((await workspace.members()).map(({ id, name, email, isAdmin }) => ({ id, name, email, isAdmin })))))
```

Como son los mismos casos de uso, todo lo demás viene gratis. Una tarjeta asignada
desde Claude manda un email a su persona, desde un worker. Un movimiento que choca
con alguien que arrastra la misma tarjeta en el navegador se reintenta. Asignar a
alguien que no es miembro se rechaza. Cuando un caso de uso lanza un error, el SDK
responde la llamada a la herramienta con `isError` y el mensaje del error, que el
asistente lee. Y el registro de actividad de la tarjeta apunta cada cambio con
`via: 'mcp'`, porque es por donde entró el actor.

Escribe las descripciones de las herramientas para el asistente: qué hace la
herramienta, de dónde salen sus ids
(`'A member\'s id, from list_members; null to unassign'`), y anotaciones que digan si
solo lee (`readOnlyHint`) o cambia algo.

## CORS

Algunos clientes MCP funcionan en un navegador. El MCP inspector es uno: descubre, se
registra, cambia su código y llama a `/mcp` desde una página web de otro origen. Así
que `/mcp`, los metadatos del recurso protegido y los endpoints de auth que el
cliente llama por sí mismo están abiertos a cualquier origen con `openToBrowsers`:

```ts
// cooper/backend/shared/cors.ts
/**
 * What a page of another origin may send and read: the MCP inspector, for one, runs
 * in a browser, and finds out how to sign in, registers, trades its code and calls
 * the MCP server from there. Never with cookies: who it is goes in its bearer token,
 * so any origin may ask.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
  'access-control-max-age': '86400',
}
```

`*` es seguro aquí porque ninguna de estas rutas lee una cookie. Quién llama va en el
token bearer, que una página de otro origen no puede robar del navegador de la
persona. La API de boards, que funciona con la cookie de sesión, no se abre.

## Cómo comprobarlo

El test de punta a punta de cooper conecta un cliente MCP como lo haría Claude. Solo
conoce `/mcp`, sigue el 401 hasta los metadatos, se registra, hace entrar a Ana por
auth con PKCE y cambia el código:

```ts
// cooper/backend/cooper.test.ts
// It only knows the MCP server's address: the 401 says where to find the rest.
const refused = await fetch(boardsUrl('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
expect(refused.status).toBe(401)
const metadataUrl = refused.headers.get('www-authenticate')!.match(/resource_metadata="([^"]+)"/)![1]!
const resource = (await (await fetch(metadataUrl)).json()) as { resource: string, authorization_servers: string[] }
// …
```

Luego usa las herramientas con el cliente del propio SDK:

```ts
// cooper/backend/cooper.test.ts
expect(await use(client, 'list_members', { workspaceId: acme.id })).toEqual([
  { id: ana.id, name: 'Ana', email: 'ana@cooper.test', isAdmin: true },
  { id: bob.id, name: 'Bob', email: 'bob@cooper.test', isAdmin: false },
])
// …
const card = await use<{ id: string, number: number }>(client, 'create_card', { workspaceId: acme.id, boardId: boards.items[0]!.id, columnId: todo.id, title: 'Ship the MCP server' })
expect(card.number).toBe(2)
expect(await use(client, 'move_card', { workspaceId: acme.id, cardId: card.id, columnId: doing.id })).toMatchObject({ columnId: doing.id, position: 0 })
expect(await use(client, 'assign_card', { workspaceId: acme.id, cardId: card.id, assigneeId: bob.id })).toMatchObject({ assignee: { id: bob.id, name: 'Bob' } })
// …
```

Cuando han corrido los workers, la actividad de la tarjeta dice que lo hizo el
asistente, como Ana:

```ts
// cooper/backend/cooper.test.ts
expect(activity.items.map(entry => [entry.kind, entry.actorId, entry.via])).toEqual([
  ['unassigned', ana.id, 'mcp'],
  ['assigned', ana.id, 'mcp'],
  ['moved', ana.id, 'mcp'],
  ['created', ana.id, 'mcp'],
])
```

Y un espacio en el que Ana no está tampoco existe para su asistente:

```ts
// cooper/backend/cooper.test.ts
// As on the web: a workspace the person is not in does not exist to them.
const result = (await client.callTool({ name: 'list_boards', arguments: { workspaceId: '01900000-0000-7000-8000-000000000000' } })) as { isError?: boolean, content: { text: string }[] }
expect(result.isError).toBe(true)
```

```bash
bun test cooper/backend/cooper.test.ts
```

Con cooper en marcha, una petición sin token dice adónde ir:

```bash
curl -i -X POST http://localhost:5172/mcp
```

```http
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer resource_metadata="http://localhost:5172/.well-known/oauth-protected-resource/mcp"
```

## Conecta un cliente de verdad

Arranca cooper con sus datos de ejemplo:

```bash
bun run cooper:seed
bun run cooper
```

Usa la **URL pública** de boards, `http://localhost:5172/mcp` en desarrollo. El
servidor de su interfaz pasa `/mcp` y `/.well-known` al puerto de boards, y los
tokens son para esa dirección: el recurso es la URL pública más `/mcp`.

**Claude Code.** Añade el servidor y autentícate desde dentro de Claude Code con
`/mcp`. El navegador abre la página de entrada de auth. Entra como `ana@cooper.dev`
con la contraseña `cooper-demo`, y permite el acceso:

```bash
claude mcp add --transport http cooper http://localhost:5172/mcp
```

**El MCP inspector.** Lánzalo, elige el transporte Streamable HTTP, escribe
`http://localhost:5172/mcp` y conecta. Pasa por el mismo flujo OAuth desde su página:

```bash
bunx @modelcontextprotocol/inspector
```

Después pide los espacios de Ana, o mueve una tarjeta, y mira cómo se mueve en la
interfaz de boards.

## En resumen

- Un servidor MCP es **otra puerta de entrada**, como las rutas: las herramientas
  llaman a los mismos casos de uso, como la persona del token, en el mismo ámbito de
  espacio.
- **Los metadatos del recurso protegido** dicen que el servidor de autorización es
  auth; un 401 con `WWW-Authenticate` apunta a ellos.
- **Verifica el token bearer en el mismo proceso** con `token.verify` de auth, y
  acéptalo solo para este recurso. Luego ejecuta la petición con `runAsActor`,
  `via: 'mcp'`.
- `via` dice **por dónde** entró alguien, nunca lo que puede hacer: va al registro
  (los eventos y la actividad de una tarjeta), no a las reglas.
- Da forma a las herramientas según **las preguntas del asistente**
  (`list_members`), cada una una llamada fina a casos de uso que ya tienes.
- Una herramienta que recibe un espacio entra en él con **`inWorkspace`**: la misma
  comprobación que el grupo de rutas.
- Las rutas que funcionan con un token bearer, nunca con una cookie, pueden estar
  **abiertas a cualquier origen**.
