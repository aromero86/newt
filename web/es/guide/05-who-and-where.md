# Quién y dónde

Hasta ahora, quién hacía cada cosa lo decía en los tests una cabecera `x-user`. Una
aplicación de verdad tiene que responder tres preguntas en cada petición:

- **¿Quién es?** La autenticación.
- **¿Puede hacer esto?** La autorización.
- **¿Sobre qué está trabajando?** Los ámbitos (*scopes*): el actor, y lo que añada tu
  aplicación. En cooper, el espacio de trabajo (*workspace*).

Este capítulo responde a las tres en `boards`, y enseña dónde vive cada respuesta.

## El actor

Cada petición con sesión se ejecuta como su **actor**. Cualquier caso de uso, por
profundo que esté, sabe quién actúa con `currentActor()`. Nunca pasas el id del
usuario de mano en mano.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async create(input: TenantCreateDTO): Promise<TenantDTO> {
  const { name } = TenantCreateSchema.parse(input)
  const tenant = Tenant.create({ name, createdBy: currentActor().userId })
  // …
}
```

Quien crea el espacio de trabajo es quien ha iniciado sesión. Si `create` aceptara un
parámetro `createdBy`, cualquiera podría crear un espacio a nombre de otro.

Fuera de HTTP (un script, una herramienta MCP) el actor lo pones tú con `runAsActor`.
El seed lo hace para actuar como Ana:

```ts
// cooper/scripts/seed.ts
const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id }, fn)
```

El framework solo sabe una cosa del actor: su `userId`. Es todo lo que cooper
necesita. Si tu aplicación necesita más (la sesión por la que entró, si es un
asistente), puedes ampliar el tipo `Actor` con `declare module 'newt/core'`, en un
fichero que carguen todos los programas de la aplicación. Amplíalo con **quién** es
alguien, nunca con **qué puede hacer**: enseguida verás por qué.

## Autenticación: quién es

El router le pregunta a un **authenticator** quién envía cada petición. Devuelve el
actor, o `null` si no hay sesión, y entonces el router responde 401 sin llamar a la
ruta. Se fija una vez por contexto, con `http.authenticateWith`.

En cooper, la gente inicia sesión en `auth`, el servidor OAuth (capítulo
[20](./20-oauth-server)). `boards` y `backoffice` son clientes OAuth suyos, y es su
servidor el que hace el OAuth: un *backend for frontend*. El navegador nunca tiene un
token, solo la cookie de sesión del propio contexto. Esa pieza reutilizable vive en
`cooper/backend/shared/web-session`, un módulo que inicializan los dos contextos:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
const session = WebSession_Module.initialize(base, {
  context: 'boards',
  clientId: WORKSPACES_PRODUCT,
  clientSecret: config.clientSecret,
  publicUrl: config.publicUrl,
  authUrl: config.authPublicUrl,
  days: config.sessionDays,
  identify: accessToken => deps.auth.token.verify(accessToken),
  // …
})
```

Registra cuatro rutas (`GET /api/session/sign-in`, `GET /api/session/callback`,
`GET /api/session`, `POST /api/session/sign-out`) y el authenticator:

```ts
// cooper/backend/shared/web-session/web-session.routes.ts
// Every route of the context runs as whoever its session cookie says.
base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(cookies.session) ?? undefined))
```

El authenticator no lee la base de datos por su cuenta. Le pregunta a un **caso de
uso** del módulo que sabe de sesiones:

```ts
// cooper/backend/shared/web-session/web-session.module.ts
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
  return { userId: session.userId }
}

// …
private async find(token: string | undefined): Promise<WebSession | undefined> {
  const parsed = SecretToken.schema.safeParse(token)
  return parsed.success ? this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
}
```

La sesión guarda **solo el hash** de su token. El token va a la cookie y nunca vuelve
al store:

```ts
// cooper/backend/shared/web-session/web-session.ts
static open(userId: string, days: number): { session: WebSession, token: SecretToken } {
  const token = SecretToken.generate()
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
  return { session: new WebSession({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
}
```

`SecretToken` es un value object del framework: 32 bytes al azar, y su `hash`. Si
alguien se lleva una copia de la base de datos, no le sirve para entrar como nadie:
tiene hashes, no tokens.

El inicio de sesión en sí es OAuth con PKCE, sin más. `complete` cambia el código de
auth por un token de acceso por HTTP, le pregunta a auth de quién es, le devuelve los
tokens y abre la sesión:

```ts
// cooper/backend/shared/web-session/web-session.module.ts
@UseCase({ retryOnConflict: false })
async complete(input: { code?: string, state?: string, error?: string, errorDescription?: string, pending?: string }): Promise<{ token: SecretToken, returnTo: string }> {
  // …
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

Fíjate en `retryOnConflict: false`. Lo explica el capítulo [7](./07-concurrency).

Una ruta que puede llamar cualquiera lo dice con `{ public: true }`. Todas las demás
necesitan sesión:

```ts
// cooper/backend/shared/web-session/web-session.routes.ts
// Public: signing out with a session already gone still clears the cookie.
base.http.post('/session/sign-out', async request => {
  await sessions.signOut(request.cookies.get(cookies.session) ?? undefined)
  request.cookies.delete({ name: cookies.session, path: '/' })
  return new Response(null, { status: 204 })
}, { public: true })
```

El servidor MCP se autentica de otra forma, con un bearer token que comprueba
`token.verify` de auth en el mismo proceso (capítulo [21](./21-mcp-server)). La idea es
la misma: averiguar quién es, y ejecutar como él con `runAsActor`.

### Compruébalo

`web-session.test.ts` levanta auth y un pequeño contexto cliente en dos puertos, y
lleva un navegador por todo el inicio de sesión:

```ts
// cooper/backend/shared/web-session/web-session.test.ts
// Back in the client: the code is traded over HTTP, and the browser goes where it was going.
const back = await as(redirectTo)
expect(back.status).toBe(302)
expect(back.headers.get('location')).toBe('/boards/1')
expect(await (await as(clientUrl('/api/session'))).json()).toMatchObject({ id: ana.id, email: 'ana@cooper.test' })
expect(await (await as(clientUrl('/api/whoami'))).json()).toEqual({ userId: ana.id })
// It keeps no token: it gave them back once it knew who signed in.
expect(await auth.base.store.table('token').count()).toBe(0)
```

Con cooper en marcha (`bun run cooper`), una petición sin la cookie se rechaza:

```bash
curl -i http://localhost:3002/api/workspaces
# HTTP/1.1 401 Unauthorized
# {"error":"…","code":"not_signed_in"}
```

## Autorización: puede hacerlo

Saber quién es alguien no dice qué puede hacer. Eso lo decide **el módulo que lo
sabe**, y se le pregunta **cada vez**, desde el caso de uso.

En `boards`, la pregunta es "¿esta persona es de este espacio de trabajo?". Los
espacios y sus miembros son de auth (un espacio es un *tenant* de auth; sus miembros,
quienes tienen acceso a él). `boards` pregunta a través de un **puerto**, un tipo con
sus propias palabras:

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
export type Workspaces = {
  /** Whether someone belongs to a workspace now: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
}
```

Quien abre los contextos lo conecta con `access.check` de auth:

```ts
// cooper/backend/open-contexts.ts
workspaces: {
  isMember: async (workspaceId, userId) => (await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) !== null,
  // …
},
```

Y el módulo `member` de `boards` convierte la respuesta en un caso de uso:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
/**
 * The workspace scope for the signed-in person, if they belong to it: what a route
 * under `/workspaces/:workspaceId` runs in. To anyone else it does not exist (404,
 * not 403: a private thing does not own up to existing).
 */
@UseCase()
async enter(workspaceId: string): Promise<WorkspaceScope> {
  if (!await this.deps.workspaces.isMember(workspaceId, currentActor().userId)) throw new WorkspaceNotFound(workspaceId)
  return { workspaceId }
}
```

Tres decisiones, y su porqué:

- **Los permisos no van en el actor.** El actor se calcula al entrar la petición. Si
  llevara los permisos, sacar a alguien de un espacio no contaría hasta su próxima
  sesión. Preguntando al módulo cada vez, cuenta al instante.
- **Pregunta el caso de uso, no la ruta.** Así vale igual desde HTTP, un script o una
  herramienta MCP: no hay una puerta trasera que se olvidó de comprobar.
- **404 a los de fuera, 403 a los de dentro.** A quien no es de un espacio se le dice
  que no existe. Una cosa privada nunca confiesa que existe:

```ts
// cooper/backend/contexts/boards/modules/member/errors/workspace-not-found.ts
/** A workspace the person does not belong to, or that does not exist: to them, the same thing. */
export class WorkspaceNotFound extends NotFoundError {
  readonly code = 'workspace.not_found'
  // …
}
```

Un miembro que intenta algo que solo puede hacer el administrador ya sabe que el
espacio existe. Esconderlo no tendría sentido: recibe un 403, con un error que extiende
`ForbiddenError`.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/** The signed-in person is its admin. Who is not even a member is told it does not exist. */
private async assertAdmin(tenantId: string): Promise<void> {
  const access = await this.deps.access.check(currentActor().userId, this.options.productId, tenantId)
  if (!access) throw new TenantNotFound(tenantId)
  if (access.role !== 'admin') throw new NotTenantAdmin()
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/errors/not-tenant-admin.ts
/** A member who is not the workspace's admin, trying what only the admin may do. */
export class NotTenantAdmin extends ForbiddenError {
  readonly code = 'tenant.not_admin'
  // …
}
```

### Compruébalo

El test de punta a punta de cooper levanta todos los contextos con el auth de verdad,
y enseña las tres respuestas:

```ts
// cooper/backend/cooper.test.ts
// A member works in it, but only its admin renames it, invites or deletes it.
expect(await call(bob.as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Mine' })).toMatchObject({ status: 403, body: { code: 'tenant.not_admin' } })
// …
// Somebody else, signed in, is told it does not exist.
const eve = await signUp('eve@cooper.test', 'Eve')
expect(await call(eve.as, 'GET', `/workspaces/${acme.id}/members`)).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
expect((await call(browser(), 'GET', '/workspaces')).status).toBe(401)
```

## Ámbitos: trabajar dentro de un espacio

Casi todo en `boards` pasa **dentro de un espacio de trabajo**: sus tableros, sus
columnas, sus tarjetas. Podrías pasar un `workspaceId` a cada caso de uso y comprobar
en cada uno que el actor es miembro… y olvidarlo en uno.

newt te deja definir **ámbitos** (*scopes*): un valor que viaja con el trabajo, igual
que el actor. Se pone una vez donde entra el trabajo, y se lee en cualquier punto por
debajo. El actor es uno; los demás los define tu aplicación con `defineScope`:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
/** The workspace the work in progress is about: an auth tenant, by its id. */
export type WorkspaceScope = {
  workspaceId: string
}

export const workspaceScope = defineScope<WorkspaceScope>('workspace', {
  missing: () => new Error('No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one'),
})

/** The id of the workspace the work in progress is about; throws outside one. */
export function currentWorkspaceId(): string {
  return workspaceScope.current().workspaceId
}
```

Un ámbito tiene tres métodos: `run(valor, fn)` ejecuta `fn` dentro de él, `current()`
lo lee (y lanza un error si no hay ninguno) y `find()` lo lee si lo hay.

### El grupo y su middleware

Las rutas que comparten prefijo pueden compartir un **middleware** con `http.group`.
Se ejecuta después de comprobar la sesión, alrededor de cada ruta del grupo. Puede
responder él (un error) o seguir con `next()`. Aquí sigue dentro del espacio:

```ts
// cooper/backend/contexts/boards/workspace-routes.ts
/**
 * The routes about one workspace, under `/api/workspaces/:workspaceId`: each one runs
 * in that workspace once `member.enter` has checked the signed-in person belongs to it
 * (404 for anyone else), so no use case below has to, nor can forget to. Every module
 * of `boards` registers its routes on it.
 */
export function workspaceRoutes(base: BoardsBase, members: Member_Module) {
  return base.http.group('/workspaces/:workspaceId', async (request, next) =>
    workspaceScope.run(await members.enter(request.params.workspaceId), next))
}
```

Cada módulo registra sus rutas en ese grupo, y se escriben como cualquier ruta:

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
export function registerBoardRoutes(base: BoardsBase, boards: Board_Module, deps: Board_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  workspace.post('/boards', async request => {
    const input = await request.json() as BoardCreateDTO
    return Response.json(await boards.create(input), { status: 201 })
  })
  // …
}
```

La pertenencia se comprueba **una vez**, para todas las rutas del grupo. Y ningún caso
de uso puede olvidarla: fuera de un espacio, `currentWorkspaceId()` lanza un error en
lugar de devolver los tableros de nadie.

### El scope del repositorio

Aún queda algo que se puede olvidar: añadir el `workspaceId` a cada consulta. Si las
filas de una tabla son de un espacio, díselo al repositorio con `scope`, y lo hará él
en todas:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
constructor(base: BoardsBase) {
  super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
    // Archiving stamps `deletedAt`: an archived board is in no list, and its name is free again.
    softDelete: true,
    // Every find, count and page sees the current workspace's boards only.
    scope: { field: 'workspaceId', current: currentWorkspaceId },
  })
}
```

Y el caso de uso nunca nombra el espacio al leer:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** A page of the workspace's boards, the newest first. */
@UseCase()
async list(page: PageRequest): Promise<Page<BoardDTO>> {
  const found = await this.repo.page({}, page, { newestFirst: true })
  // …
}
```

Solo lo dice una vez, al crear algo: un tablero nuevo es del espacio actual.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
```

Lo que te da el scope:

- `find`, `first`, `count` y `page` **solo ven las filas del espacio actual**, digan
  lo que digan sus criterios. Un tablero de otro espacio es "no encontrado".
- Guardar una entidad de **otro** espacio es un error, no una escritura.
- **Fuera de un ámbito, `current()` lanza un error**, y el repositorio no lee nada.
- Lo que mira entre espacios **a propósito** usa `findInEveryScope`, un método
  protegido: se queda dentro del repositorio, con un nombre que se ve en una revisión.
- Lo protegido son **esos métodos**. Lo que el repositorio lea o escriba por su cuenta
  (`this.table`, Kysely, `saveRows`, el `after` de un guardado) pone el filtro él
  mismo. La búsqueda de tarjetas lo hace con Kysely:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
const matching = await this.base.db
  .selectFrom('card')
  .select('id')
  .where('workspaceId', '=', currentWorkspaceId())
  // …
```

### Entrar en un ámbito sin ruta

Lo que no llega por el router entra en el ámbito por su cuenta, con `run`.
`workspace-scope.ts` da dos maneras:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
/** Runs in a workspace without checking who may: for workers and scripts, which already know. */
export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return workspaceScope.run({ workspaceId }, fn)
}

/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
```

- **Una herramienta MCP** actúa por una persona y nombra un espacio: entra con
  `inWorkspace`, que comprueba la pertenencia igual que el grupo.
- **Un worker** nunca hereda un ámbito: se ejecuta solo, más tarde. Sabe su espacio
  por su evento, y entra con `runInWorkspace`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async unassignMember(workspaceId: string, userId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const cards = await this.repo.find({ assigneeId: userId })
    for (const card of cards) card.unassign()
    await this.repo.persist(...cards)
  })
}
```

- **Otro contexto** (el backoffice) también nombra el espacio, y un caso de uso pensado
  para él entra en él:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** For other contexts (the backoffice): a page of a workspace's boards, the newest first. */
@UseCase()
async listOf(workspaceId: string, page: PageRequest): Promise<Page<BoardDTO>> {
  return runInWorkspace(workspaceId, () => this.list(page))
}
```

### Compruébalo

Los tests entran en un espacio como una persona, igual que una ruta:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
/** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
as<T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return runAsActor({ userId }, () => inWorkspace(boards.modules.member, workspaceId, fn))
},
```

Y comprueban que nadie ve los tableros de otro espacio:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('shows a workspace\'s boards to its members only, and nobody else\'s', async () => {
  const roadmap = await create('Roadmap')

  await expect(t.as('bea', 'globex', () => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
  await expect(t.as('bea', 'acme', () => t.modules.board.list({ size: 10 }))).rejects.toMatchObject({ code: 'workspace.not_found' })
  expect((await t.modules.board.listOf('acme', { size: 10 })).items.map(board => board.id)).toEqual([roadmap.id])
})
```

Por HTTP, en `boards.context.test.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
test('lets only a workspace\'s members in, and tells nobody else it exists', async () => {
  expect((await call('GET', '/acme/boards', undefined, null)).status).toBe(401)
  expect(await call('GET', '/acme/boards', undefined, 'bea')).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
  expect(await call('GET', '/acme/boards')).toMatchObject({ status: 200, body: { items: [], total: 0 } })
})
```

## Cuando no hace falta nada más

Los ámbitos son **opcionales**, y los define tu aplicación: newt no sabe qué es un
espacio de trabajo. `auth` no define ninguno: le basta el actor, y sus casos de uso
reciben el id del tenant y comprueban el acceso ellos mismos. `boards` tiene el actor
y un espacio de trabajo. Otra aplicación puede tener el actor y una tienda, o un
cliente. Cada una define los que necesita, con las mismas tres piezas: `defineScope`,
`http.group` y `run`.

## En resumen

- Un caso de uso sabe quién actúa con `currentActor()`. Nunca recibas un id de usuario
  como parámetro para "lo mío".
- La autenticación es un caso de uso del módulo que guarda las sesiones; el router lo
  llama mediante `authenticateWith`. Guarda solo el hash de un token.
- La autorización se le pregunta al módulo que lo sabe, cada vez, desde el caso de uso.
  Nunca metas los permisos en el actor.
- 404 a quien no es de dentro; 403 al miembro que no puede.
- Define un ámbito para aquello dentro de lo que pasa casi todo el trabajo. Entra en él
  una vez: en el middleware de un grupo, con `inWorkspace` en una herramienta MCP, con
  `runInWorkspace` en un worker.
- Dale al repositorio su `scope`, para que ninguna consulta olvide el espacio. Filtra a
  mano solo en lo que el repositorio lee por su cuenta (Kysely, `this.table`).
