# Las reglas de newt

Cómo se construye una aplicación sobre newt: sus contextos, sus módulos y las reglas
que siguen, con la API en la que se escribe cada regla. La guía las enseña de una en
una, mientras construye cooper; esta página las reúne todas en un sitio, y cada
ejemplo sale del backend de cooper. Cómo se guardan los datos, y cómo guardarlos en
otro sitio, está en [Stores](./stores). Lo que comprueba el lint está en
[Lint](./lint).

## Contextos

Una aplicación es uno o varios contextos delimitados (*bounded contexts*). Cada uno es
dueño de su store, de sus módulos y, si los tiene, de sus puntos de entrada. cooper
tiene tres: `auth`, `boards` y `backoffice`.

```ts
// cooper/backend/contexts/boards/boards.context.ts
static async open(config: Boards_Config, deps: Boards_ModuleDeps, tracer?: Tracer): Promise<Boards_Context> {
  const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
  const base = new BoardsBase({ name: 'boards', store, tracer })
  return new Boards_Context(base, initializeModules(base, config, deps), config, deps.auth)
}
```

- **Cada contexto elige su store** y lo abre al día (abrirlo aplica las migraciones
  pendientes, primero las del contexto y luego las del propio framework), y después
  construye su `Base` sobre él. `Base` da a cada módulo el store, las `invocations` de
  sus casos de uso, el `bus` de eventos, el `publisher` en el que publican sus
  repositorios y los `jobs` de sus suscripciones `handler`. Sus opciones son `name`,
  `store` y, si hacen falta, un `tracer`, la configuración de `jobs`, la `writeRule` y
  un `clock`: por el que van el `createdAt` y el `updatedAt` de sus entidades, cuándo
  tocan sus trabajos y sus esperas entre reintentos, y `now()` en sus casos de uso y sus
  handlers (la hora real por defecto; un test mueve el suyo,
  `{ now: () => new Date(time) }`, en vez de esperar).
- **Una aplicación da más a sus módulos extendiendo `Base`**: un router HTTP, un
  mailer, un constructor de consultas sobre la conexión del store.

  ```ts
  // cooper/backend/shared/cooper-base.ts
  export class CooperBase extends Base<SqliteStore> {
    readonly http = new HttpRouter()
  }
  ```

  ```ts
  // cooper/backend/contexts/boards/boards-base.ts
  export class BoardsBase extends CooperBase {
    readonly db = kyselyFor<BoardsDatabase>(this.store)
  }
  ```
- **Un contexto es un `BoundedContext`**: `start()` arranca su worker de trabajos y
  `stop()` espera a los trabajos en curso y cierra su store. Cómo se sirve es cosa de
  la aplicación: `serve`, de `newt/http`, es una forma, y es la que usa el
  `ServedContext` de cooper.
- **Los contextos dependen unos de otros sin formar un círculo**: cada uno se abre
  después de los que usa, y recibe sus módulos, o puertos hechos con ellos.

  ```ts
  // cooper/backend/open-contexts.ts
  const tracer = options.tracer ?? (config.trace ? new ConsoleTracer() : undefined)
  const auth = await Auth_Context.open(config.auth, { mailer }, tracer)
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, log: tracer && (line => console.log(line)) }, tracer)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, tracer)
  ```
- Un contexto llega a otro solo a través de los casos de uso y los eventos de ese otro,
  nunca de su base ni de su store. El tipo de sus deps dice qué módulos, como un
  `Pick`, así que nada más queda a su alcance:

  ```ts
  // cooper/backend/contexts/backoffice/initialize-modules.ts
  export type Backoffice_ModuleDeps = {
    auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
    boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
  }
  ```

  Llamar a otro contexto es como llamar a una API de fuera: lo que
  ha guardado se queda guardado haga lo que haga después quien llama, así que quien
  llama lo pone detrás de todo lo que aún pueda fallar, y hace que se pueda repetir
  sin problema.

## Puntos de entrada

- Un punto de entrada traduce una petición en una llamada a un caso de uso, y su
  resultado en una respuesta. **Nada de lógica de negocio en un punto de entrada.**
- Con `newt/http`, cada módulo registra sus rutas en el `HttpRouter` del contexto
  (`<m>.routes.ts`), todas bajo un prefijo (`/api` por defecto; `new HttpRouter({
  prefix })` para otro). La ruta tipa sus parámetros (`/boards/:boardId` da
  `request.params.boardId`).

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.routes.ts
  workspace.post('/boards', async request => {
    const input = await request.json() as BoardCreateDTO
    return Response.json(await boards.create(input), { status: 201 })
  })

  workspace.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))
  ```
- **Lo que lanza una ruta se convierte en una respuesta**: un error de dominio, con su
  estado y su código (`{ error, code }`); una entrada no válida, en un 400 (un cuerpo
  que no se puede leer, `malformed_body`, o uno que no pasa el esquema del caso de uso,
  `validation`, con los `issues` de zod); cualquier otra cosa, en un 500 que no cuenta
  nada de dentro. Una entidad que no pasa su propio esquema (`InvalidEntity`) es un
  error de programación, así que también es un 500. Un cuerpo JSON tiene que llegar
  como `application/json` (o `…+json`); cualquier otro `Content-Type` es un 415,
  `unsupported_media_type`, de modo que un formulario enviado desde otra web nunca
  llega a una ruta. Una dirección bajo el prefijo sin ruta es un 404, y un método que
  la dirección no tiene, un 405.
- **Toda ruta necesita una sesión**, salvo que se registre con `{ public: true }`. El
  router pregunta a su `Authenticator` quién ha enviado la petición, y la ruta se
  ejecuta como ese actor: cualquier caso de uso al que llegue sabe quién lo hace con
  `currentActor()`. Nunca pases el id del usuario a mano. Cualquier otro punto de
  entrada (una CLI, un servidor MCP, un script) se ejecuta como un actor de la misma
  forma, con `runAsActor`.

  ```ts
  // cooper/backend/shared/served-context.ts
  base.http.get('/health', () => Response.json({ status: 'ok', context: name }), { public: true })
  ```

  ```ts
  // cooper/backend/contexts/boards/mcp/mcp.ts
  return await runAsActor({ userId: identity.userId, via: 'mcp' }, () => transport.handleRequest(request))
  ```
- **Las rutas que comparten prefijo pueden compartir un middleware**:
  `http.group(prefijo, middleware)`. Se ejecuta después de comprobar la sesión,
  alrededor de cada ruta del grupo, y puede responder él o seguir con `next()`,
  normalmente dentro de un ámbito propio (ver
  [Quién y dónde](#quien-y-donde-el-actor-y-otros-ambitos) más abajo). Los parámetros
  de una ruta son los de su grupo más los suyos.
- Las rutas que no son del router (una entrada MCP, un documento `/.well-known`) van a
  su lado: `serve({ port, router, routes, frontend })` sirve las rutas del router, las
  que se le dan en `routes` y un frontend compilado para cualquier otra dirección.

## Quién y dónde: el actor y otros ámbitos

**El actor** es quien hace lo que se está haciendo. El framework solo conoce su
`userId`. Una aplicación que necesite más lo añade ampliando la interfaz `Actor`, una
vez, en un fichero que carguen todos los programas de la aplicación. cooper añade cómo
entró la persona, por sus aplicaciones web o por un asistente de IA:

```ts
// cooper/backend/shared/actor.ts
import 'newt/core'

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

`CooperBase` importa ese fichero (`import './actor'`), así que todo programa que abre
un contexto lo tiene. A partir de ahí `currentActor()` devuelve esos campos, y cada
sitio que dice quién actúa tiene que darlos: el autenticador, `runAsActor`. Un campo
obligatorio no se puede olvidar; el compilador encuentra cada sitio. Limítalo a quién
es alguien y cómo entró, nunca a lo que puede hacer. Fuera de cualquier actor, `currentActor()` lanza `NoActor`, un 401.

**La autenticación** (quién es) es el `Authenticator` del router: lee la petición (una
cookie de sesión, un token) y pregunta a un módulo de sesiones, a través de un caso de
uso, quién es.

```ts
// cooper/backend/shared/web-session/web-session.routes.ts
base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(cookies.session) ?? undefined))
```

Una sesión guarda solo el hash de su token (`SecretToken.hash`), así que una copia de
la base de datos no abre nada:

```ts
// cooper/backend/shared/web-session/web-session.ts
static open(userId: string, days: number): { session: WebSession, token: SecretToken } {
  const token = SecretToken.generate()
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
  return { session: new WebSession({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
}
```

**La autorización** (si puede hacerlo) nunca va en el actor: el caso de uso pregunta
al módulo que lo sabe, cada vez, así que un permiso retirado cuenta al momento. Quien
no es miembro recibe un 404, no un 403: algo privado nunca dice que existe.

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
@UseCase()
async enter(workspaceId: string): Promise<WorkspaceScope> {
  if (!await this.deps.workspaces.isMember(workspaceId, currentActor().userId)) throw new WorkspaceNotFound(workspaceId)
  return { workspaceId }
}
```

**Otros ámbitos.** Un valor que viaja con el trabajo igual que el actor (el espacio de
trabajo del que trata una petición, un tenant) es un ámbito (*scope*) que la
aplicación define con `defineScope`. Un ámbito tiene `run(valor, fn)`, `current()`
(que lanza un error fuera de él, el que se le dio como `missing` si se le dio alguno)
y `find()` (que en ese caso da `undefined`).

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
export const workspaceScope = defineScope<WorkspaceScope>('workspace', {
  missing: () => new Error('No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one'),
})

export function currentWorkspaceId(): string {
  return workspaceScope.current().workspaceId
}
```

```ts
// cooper/backend/contexts/boards/workspace-routes.ts
export function workspaceRoutes(base: BoardsBase, members: Member_Module) {
  return base.http.group('/workspaces/:workspaceId', async (request, next) =>
    workspaceScope.run(await members.enter(request.params.workspaceId), next))
}
```

El middleware comprueba la pertenencia una sola vez para todas las rutas del grupo, y
ningún caso de uso puede olvidarse de hacerlo: sin un espacio de trabajo en el ámbito,
`current()` lanza un error. Lo que no llega por el router (un worker, un script, un
servidor MCP) entra en él por su cuenta con `run(...)`; un worker sabe en cuál por su
evento. cooper envuelve las dos formas en `inWorkspace` (comprueba la pertenencia,
para las herramientas MCP) y `runInWorkspace` (sin comprobar, para workers y
scripts). Una aplicación que solo tiene usuarios no define nada: con el actor basta.

Un repositorio cuyas filas pertenecen a un espacio de trabajo lo dice una vez, y a
partir de ahí ninguna de sus consultas puede olvidar el filtro (la entidad también
lleva el `workspaceId`):

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
  softDelete: true,
  scope: { field: 'workspaceId', current: currentWorkspaceId },
})
```

`find`, `first`, `count` y `page` ven solo las filas del espacio de trabajo actual;
guardar una entidad de otro, o una que estaba guardada en otro, lanza un error; fuera
de un ámbito `current()` lanza un error, así que un worker entra antes en él. Lo que
mira a través de los espacios de trabajo a propósito usa el método protegido
`findInEveryScope`, detrás de un método cuyo nombre lo dice, al que no llega ninguna
ruta de la gente del propio espacio:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
/**
 * The boards created last, in every workspace: for the staff, who look across them
 * on purpose. Archived ones stay out.
 */
recentInEveryScope(limit: number): Promise<Board[]> {
  return this.findInEveryScope({}, { limit, orderBy: [{ field: 'id', direction: 'desc' }] })
}
```

Lo que una subclase lee o escribe por su cuenta (`this.table`,
Kysely, `saveRows`, el `after` de un guardado) añade el filtro ella misma, como hace
la búsqueda de tarjetas de cooper con `.where('workspaceId', '=',
currentWorkspaceId())`.

## Módulos

### Una responsabilidad

Un módulo es dueño de una cosa: sus datos, las reglas sobre esos datos y lo que pasa
cuando cambian. Si para describirlo necesitas un "y", son dos módulos. Un módulo no es
una tabla ni una pantalla: es una responsabilidad.

**La entidad del módulo lleva el nombre del módulo** (`board` → `Board`). Una entidad
con otro nombre es una segunda responsabilidad, y va a un módulo propio.

**Los módulos de un mismo tema comparten prefijo**, para que queden juntos: en el
`auth` de cooper, `oauth-client` y `oauth-grant`. El prefijo es parte del nombre en
todas partes (`OauthGrant_Module`, entidad `OauthGrant`, tabla `oauth_grant`, caso de
uso `oauthGrant.redeem`), y cada uno sigue siendo un módulo por sí mismo.

### Anatomía

`<contexto>/modules/<módulo>/` (en *kebab-case*):

| Fichero | Qué contiene |
|---|---|
| `<m>.schema.ts` | Los esquemas de zod y los tipos de los DTOs: el **contrato público** del módulo, lo que entra y sale de sus casos de uso y sus eventos. Todo lo que exporta empieza por el nombre de la entidad (`BoardSchema`, `BoardCreateDTO`). |
| `<m>.ts` | La entidad: una clase que extiende `Entity<typeof <M>Schema>`. Reexporta el fichero del esquema. |
| `<m>.repository.ts` | **Lo único que toca el store.** |
| `<m>.module.ts` | `<M>_Module extends Module`: los casos de uso y sus `events`. `static initialize(base, deps?, options?)`. |
| `<m>.routes.ts` | Sus rutas, si tiene. |
| `<m>.workers.ts` | Lo que hace **como reacción** a eventos: los suyos o los de sus dependencias. |
| `<m>.deps.ts` | `<M>_Deps`: los módulos de los que depende, importados con `import type`. |
| `<m>-options.ts` | `<M>_Options`: la configuración que recibe en `initialize`. |
| `value-objects/<nombre>.ts` | Valores con reglas propias que solo usa él. |
| `errors/<error>.ts` | Una clase por cada error de dominio. |
| `events/<m>-<verbo>.ts` | Una clase por cada evento de dominio. |
| `services/<nombre>.ts` | Lógica que comparten sus casos de uso, un fichero cada una. |
| `*.test.ts` | Los tests, junto a lo que prueban. |

[`newt-eslint`](./lint) lo comprueba, junto con cómo llegan los módulos unos a otros
y cómo se llama la cola de cada `handler`.

Nombres: carpeta `oauth-grant`, clase `OauthGrant_Module`, tabla `oauth_grant`, tabla
hija `oauth_grant__<hija>`, caso de uso `oauthGrant.redeem`, evento `card.assigned`,
fichero de error `board-not-found.ts`.

### Cómo hablan los módulos

Exactamente de dos formas, y la elección es de significado:

- **Una llamada a un caso de uso**, cuando quien llama necesita la respuesta ya:
  **lecturas y comprobaciones**, desde cualquier sitio. (Nunca desde un hook de un
  guardado: se ejecutaría dentro de la transacción de ese guardado.)
- **Un evento**, cuando algo es *consecuencia* de otra cosa. Quien publica no sabe
  quién escucha.

**Escribir en otro módulo solo se hace desde un worker** que reacciona a un evento,
nunca en mitad del trabajo de un caso de uso. Cada guardado de un módulo es una
transacción propia: si un caso de uso guardara en dos módulos y fallara entre los dos
guardados, el primero se quedaría guardado sin nada que terminara el trabajo. El
trabajo de un worker, en cambio, se repite hasta que se completa; lo que escribe se
puede repetir sin efecto (es idempotente), así que el flujo siempre converge.

| Escribir en otro módulo desde… | Si falla a mitad… |
|---|---|
| un caso de uso fuera de un worker (una petición, un script, un test) | se queda a medias, y nada lo termina |
| un caso de uso al que llamó un worker (un `handler`) | su trabajo se repite hasta completarse |

El framework lo vigila mientras se ejecuta: que un caso de uso del módulo B guarde
cuando lo ha llamado un caso de uso del módulo A fuera de un worker es un error (por
defecto) o un aviso (`writeRule: 'warn'` en la `Base` de un contexto, mientras una
aplicación se adapta a la regla; `'off'` no comprueba nada). Un test o un script que
hace a mano lo que haría un worker lo ejecuta como uno:
`base.jobs.runAsWorker(() => workspaces.prepare(id))`, sin actor ni ámbito salvo los
que ponga él. Llegar al repositorio de
B desde A, saltándose sus casos de uso, es lo que `newt-eslint` rechaza. Una excepción
justificada se dice donde se vea, con el motivo al lado:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Removes a column of a board, only if no card is in it. The cards answer, since a
 * card points at its column and a column knows nothing of the cards: the column
 * module cannot ask them without the two needing each other. So this use
 * case asks, and has the column module remove it: a write to another module outside
 * a worker, said where it is seen. It is the only write it makes, so a failure leaves
 * nothing halfway; a card moved into the column at that very moment is taken to
 * another one by `leaveRemovedColumn`.
 */
@UseCase({ writesTo: ['column'] })
async removeColumn(columnId: string): Promise<void> {
  const column = await this.deps.column.get(columnId)
  const cards = await this.repo.count({ columnId })
  if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
  await this.deps.column.remove(column.id)
}
```

Un `writesTo` vale para todo lo que se escriba por debajo de ese caso de uso, lo haya
llamado quien lo haya llamado. La regla es de cada contexto: un caso de uso al que se
llama desde otro contexto es la API de su contexto, la raíz de lo que hace en el suyo,
donde la regla se cumple como en cualquier otro. (Una ruta de boards que llama a
`auth.modules.tenant.create` empieza una cadena en auth.)

**Un módulo es un agregado.** Lo que debe guardarse junto, todo o nada, es un módulo.
Dos módulos cuyos datos deben cambiar siempre a la vez son uno; si no, uno sigue al
otro mediante eventos.

- Un módulo que **conoce** a otro (está en su `<M>_Deps`) puede llamar a sus casos de
  uso y suscribirse a sus eventos. Nunca a su repositorio, sus tablas o su entidad:
  las lecturas pasan por los casos de uso de su dueño.

  ```ts
  // cooper/backend/contexts/boards/modules/card/card.deps.ts
  export interface Card_Deps {
    board: Board_Module
    column: Column_Module
    member: Member_Module
    access: AccessEvents
  }
  ```
- **Las dependencias nunca forman un círculo.** Cuando dos módulos parecen necesitarse
  el uno al otro, uno deja de llamar y empieza a escuchar. (`column` no conoce las
  tarjetas; `card` conoce las columnas y sigue a `column.removed`.)
- Un módulo nunca sabe quién depende de él.
- Lo que un módulo necesita de otro contexto es un puerto, con sus propias palabras,
  tipado en su fichero de dependencias (`AccessEvents`, arriba); el contexto le da los
  casos de uso o los emisores del otro contexto al abrirse.

## La entidad

La entidad es un esquema más comportamiento. El esquema de zod es la única fuente de
verdad de su forma; `Entity` mantiene los datos válidos y lleva la cuenta de lo que
ha cambiado.

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
export class Board extends Entity<typeof BoardSchema> {

  private constructor(input: EntityInput<BoardDTO>, isNew: boolean) {
    super(BoardSchema, input, isNew)
  }

  static fromDTO(dto: BoardDTO & { version: number }): Board {
    return new Board(dto, false)
  }

  static create(input: { workspaceId: string, name: string, description: string }): Board {
    const board = new Board({ ...input, name: BoardName.from(input.name) }, true)
    board.trackEvent(new Board_Created(board.toDTO()))
    return board
  }

  update(changes: { name?: string, description?: string }): void {
    this.change({
      ...(changes.name === undefined ? {} : { name: BoardName.from(changes.name) }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
    })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Board_Updated({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  archive(): void {
    this.markAsDeleted()
    this.trackEvent(new Board_Archived(this.toDTO()))
  }
}
```

- `create` para algo nuevo, `fromDTO` para algo guardado: `isNew` lo decide cuál de
  los dos se llama, nunca si hay un id o no. Una nueva recibe su id (UUIDv7),
  `createdAt` y `updatedAt`.
- **Solo la entidad se cambia a sí misma**: `change()` es protegido, así que un caso de
  uso llama a los métodos de la entidad (`update`, `archive`…), que dicen qué ha
  pasado con `trackEvent`. `change()` comprueba la entidad entera contra el esquema
  (también sus refinamientos), se queda con los valores que da el parseo (recortados,
  con su valor por defecto…), ignora los valores que en realidad no cambian y mueve
  `updatedAt` cuando algo cambia. Un campo que el esquema no tiene, o un cambio en una
  entidad borrada, lanza un error.
- Las reglas sobre los datos de la propia entidad viven en sus métodos; las que
  necesitan otros datos, en el caso de uso.
- **Sus métodos reciben datos de dominio, no el DTO de entrada.** El DTO es el
  contrato de la API (lo que envía un cliente, antes de comprobarlo); la entidad
  recibe lo que necesita para nacer, comprobado y a menudo completado por el caso de
  uso: una tarjeta se crea con el espacio de trabajo de su tablero, su número y su
  posición, que ningún cliente envía. Las entradas pequeñas van en línea
  (`{ workspaceId, name, description }`); una que lo merece es un tipo con un nombre de
  negocio en el fichero de la entidad, nunca un `…DTO` y nunca en el fichero del
  esquema:

  ```ts
  // cooper/backend/contexts/boards/modules/card/card.ts
  export type CardOpening = {
    workspaceId: string
    boardId: string
    columnId: string
    number: number
    position: number
    title: string
    description: string
    assigneeId: string | null
  }
  ```
- **Cada tipo de cosa se cuenta una vez por guardado, tal como queda.** Un evento
  sustituye a otro anterior con su nombre que aún no se ha guardado, así que dos
  llamadas a `update` antes de un guardado dan un solo `updated`, con los dos cambios;
  y si la segunda deshace la primera, el guardado no escribe nada ni cuenta nada. Un
  evento siempre viene con un cambio: una entidad que no cambia nada no publica nada.
  Dos tipos distintos en un guardado (`created` y `updated`) suelen indicar que el caso
  de uso hace dos cosas.
- **`getChanges()` y `getPrevious()`** son la transición que hace un guardado: los
  campos que cambiaron, como están ahora y como estaban cuando se leyó.
- **Se valida dos veces, a propósito.** El caso de uso valida lo que entra (su esquema
  de entrada, flexible, un 400 para el cliente); la entidad valida su estado
  (estricto, en cada cambio y en lo que se lee del store; no pasarlo es un error de
  programación, `InvalidEntity`, un 500). Una regla, escrita una vez: el esquema de
  entrada se deriva del de la entidad (`CardSchema.pick({ columnId: true, title: true
  })`, `CardSchema.shape.title`).
- **Tiene una `version`**: 0 hasta que se guarda, y luego la que tiene guardada.
  `fromDTO` la recibe de la fila (el constructor lanza un error sin ella, porque
  guardarla podría pisar a alguien), y el repositorio la avanza al escribirla, y la
  devuelve a su valor si el guardado se deshace.
- **Un store guarda "sin valor" como `null`**: un campo que se vacía a `undefined` se
  escribe como `null`, y se lee como `null` si su esquema lo admite (`.nullable()`,
  `.nullish()`), o se omite si solo es `.optional()`.
- Fuera de su módulo, una entidad no existe: los casos de uso devuelven `toDTO()`.

## Repositorios

Un repositorio es el único sitio que lee y escribe las entidades de un módulo.

**`TableRepository`, cuando las entidades son las filas de una tabla**, en cualquier
store: dices cómo una fila se convierte en entidad, y `find`, `first`, `count`, `page`
y `persist` vienen hechos.

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
      softDelete: true,
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }
  // …
}
```

Lo que se busca se dice con **criterios**, campo a campo, que entiende cualquier
store:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
const found = await this.repo.page({}, page, { newestFirst: true })
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(tenant => tenant.toDTO())
```

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
return toDTOs(await this.repo.page({ userId, productId }, page, { newestFirst: true }))
```

Un campo con un valor tiene que ser igual a él (`null` es "no tiene"). Los operadores
son `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte` e `ieq` (igual, sea cual sea la caja de
la A a la Z); varios en un campo deben cumplirse todos, y un campo o un operador que
queda en `undefined` no es ninguna condición, así que un filtro opcional no necesita
`if` (el `productId` de arriba puede ser undefined). `page` admite
`{ newestFirst: true }` para los más nuevos primero, con el cursor hacia atrás. Los
grupos se anidan: `and` (todos) y `or` (al menos uno). `find` y `first`
admiten también `{ orderBy, limit }` (`{ orderBy: [{ field: 'position' }] }`), y si
no, van por id. Los criterios se combinan con `allOf(a, b)`.

```ts
// packages/newt/core/criteria/criteria.ts (su documentación)
{ workspaceId, archived: false, or: [{ priceCents: { lt: 500 } }, { brandId: 'acme' }] }
```

Cualquier store los responde como lo haría SQL ([Stores](./stores#tablas-y-criterios)
explica cómo). Las opciones de la tabla (`types`, `unique`) se dicen con las mismas
palabras a todos los stores, así que el repositorio pasa de un store a otro sin
cambios. Una fila cuya forma no es la del DTO de la entidad dice cómo en `toRow` y
`toChanges`.

**Los filtros que envía un cliente** no son criterios: los criterios son para el
código del módulo, y abiertos; el filtro de un cliente es parte del contrato público,
y cerrado. `defineFilter` declara por qué puede filtrar un cliente, cada campo con
sus operadores, y los límites (3 grupos de profundidad y 20 condiciones por defecto;
un `in` admite como mucho 100 valores):

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardFilter = defineFilter({
  board: { field: 'boardId', value: z.string(), ops: ['eq', 'in'] },
  column: { field: 'columnId', value: z.string(), ops: ['eq', 'in'] },
  assignee: { field: 'assigneeId', value: z.string(), ops: ['eq', 'in'] },
  number: { field: 'number', value: z.number().int(), ops: ['eq'] },
}, { maxDepth: 2, maxConditions: 10 })

export type CardFilterDTO = z.infer<typeof CardFilter.schema>
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
  const { text, filter } = CardSearchSchema.parse(input)
  const criteria = filter ? CardFilter.toCriteria<CardRow>(filter) : {}
  const found = await this.repo.search(criteria, text, page)
  // …
}
```

Un campo u operador no declarado es un 400; lo que impone el sistema va al lado del
filtro del cliente, en un `and` (`allOf`, o un `where` al lado de los criterios), de
donde no se puede escapar. En cooper el espacio de trabajo lo impone el propio
`where('workspaceId', '=', currentWorkspaceId())` de la búsqueda, y los criterios del
cliente se unen a él gracias a `criteriaTree`, que convierte unos criterios en un árbol
(`all`, `any`, `field`) que un query builder puede traducir. Cada operador que ofreces es
una consulta que cualquiera puede lanzar: un `or` entre campos impide a una base de
datos usar sus índices, así que ofrece lo que los datos puedan responder rápido. Un
árbol de filtros viaja en el cuerpo (`POST /api/workspaces/:workspaceId/cards/search`),
no en la URL.

**Las consultas que una tabla no sabe hacer** (una suma, un join, un informe, una
búsqueda en un texto) pasan por la API propia del store. Kysely sobre la conexión del
store es la forma recomendada (`newt/kysely`): la misma consulta funciona en SQLite,
Postgres o MySQL (aunque en los servidores los recuentos de una escritura son `0n`),
los nombres de los campos son los de las filas (`workspaceId`) y se une a la
transacción en curso.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
async countByBoard(): Promise<CardCountByBoard[]> {
  const rows = await this.base.db
    .selectFrom('card')
    .select(eb => ['boardId', eb.fn.countAll<number>().as('cards')])
    .where('workspaceId', '=', currentWorkspaceId())
    .groupBy('boardId')
    .orderBy('boardId')
    .execute()
  return rows.map(row => ({ boardId: row.boardId, cards: Number(row.cards) }))
}
```

En Postgres un `COUNT` llega como texto: `Number(…)` hace que valga en los tres.

**Mantén los repositorios portables**: `TableRepository` por defecto, Kysely para lo
que no sabe decir, y el SQL de un solo store solo cuando no haya otro camino (la
búsqueda de texto completo de SQLite, por ejemplo), en un solo sitio y marcado. Nunca
pidas unos ids para devolverlos en un `in`: una consulta admite un número limitado de
parámetros (250.000 en SQLite con Bun), y una sola consulta con todo dentro no tiene
ese problema. La búsqueda de tarjetas de cooper es una consulta de Kysely, con la
página y el total. Así,
pasar a otro store es un store nuevo y sus migraciones, no repositorios nuevos.

**Las referencias entre módulos** (la columna de una tarjeta, la persona asignada) son
solo ids, como los agregados de Vaughn Vernon: nunca la otra entidad, nunca un join a
su tabla.

- Al escribir, el caso de uso comprueba que la referencia existe preguntando a su
  módulo (una lectura). `this.resolveRefs(ids, finders)` da un `ReferenceNotFound`
  (400) para una que no apunta a nada; `null` es "ninguna", y una clave que no viene
  tampoco sale. Un *finder* es cualquier cosa con `find({ id: [...] })` que dé
  `{ id, name }`:

  ```ts
  // cooper/backend/contexts/auth/modules/access/access.module.ts
  await this.resolveRefs({ productId }, { productId: this.deps.product })
  ```

  Una comprobación que necesita algo más que saber si existe hace su propia pregunta
  (la tarjeta de cooper pregunta `member.isMember(assigneeId)` y responde
  `AssigneeNotMember`, un 400).
- Cuando lo referenciado desaparece, el módulo que apunta a ello sigue su evento,
  desde un worker: un `handler` de `column.removed` que llama a
  `card.leaveRemovedColumn`, que busca las tarjetas que siguen en ella cuando se
  ejecuta.
- Mostrar nombres, y no ids, es composición del cliente (pregunta a los dos módulos), o
  un modelo de lectura que un worker mantiene a partir de los eventos.
- Una referencia puede apuntar un momento a algo borrado, entre la comprobación y el
  guardado, o antes de que se ejecute el worker: se acepta, y el worker la limpia.

**`Repository`, para todo lo demás**: entidades repartidas en varias tablas, una
consulta que un criterio no sabe decir, la API propia de un store. Da `save`, y el
repositorio escribe cada entidad a su manera (`TableRepository` está escrito así):

```ts
// packages/newt/repository/table-repository.ts
async persist(...entities: E[]): Promise<void> {
  await this.save(entities, entity => this.write(entity))
}
```

### Guardar

Una transacción es un guardado, `repo.persist(...entidades)`, nunca un caso de uso
entero.

- `persist` guarda una o varias instancias **de la entidad de su módulo** a la vez,
  todas o ninguna, con los eventos que registraron: los trabajos de esos eventos se
  escriben en la misma transacción, y sus handlers `fire-and-forget` se ejecutan
  después de confirmarla.
- Escribe solo lo que ha cambiado, y solo si cada entidad guardada sigue en la versión
  con la que se leyó: si no, lanza `ConcurrencyConflict` (409) y no escribe nada. Una
  nueva que choca con una clave o un valor único también lo lanza.
- **Un caso de uso se repite ante un `ConcurrencyConflict`**, hasta tres veces más,
  volviendo a cargar y aplicando el cambio a lo que hay guardado ahora: un caso de uso
  carga, cambia y guarda, y lo que no se puede deshacer sale de un worker. Solo se
  repite el primer caso de uso de una cadena, con todo lo que llama; uno llamado por
  otro deja pasar el conflicto hasta él. Uno que hace algo antes de guardar que no
  puede pasar dos veces (una llamada a otro contexto que ya ha guardado) dice
  `@UseCase({ retryOnConflict: false })`, con el motivo al lado: entonces nada de su
  cadena se repite, ni siquiera quienes lo llamaron.

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
  ```
- **Una regla sobre varias filas** (un nombre de tablero único en su espacio de
  trabajo, un espacio de trabajo con un solo admin) no la protege una versión: la
  comprueba el hook `after` de `save`, en la misma transacción, después de las
  escrituras; lanzar un error lo deshace todo. El guardado nombra lo que protege la
  regla, para que ningún otro guardado que proteja lo mismo se cuele en medio, en
  cualquier store:

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.repository.ts
  async persistWithNameFree(board: Board): Promise<void> {
    const { workspaceId, name } = board
    await this.save([board], each => this.write(each), {
      guard: [`boardName:${workspaceId}:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
      },
    })
  }
  ```

  En Postgres y MySQL, los guardados de otras claves nunca esperan (en SQLite y en
  ficheros cada guardado espera su turno de todos modos). Un guardado con `after` debe
  nombrar su `guard`, o no compila: `guard: []` dice, donde se lee, que no hace falta
  ninguno. `before` escribe, o lee, lo que tiene que ir primero (la tarjeta nueva de
  cooper toma ahí su número). El caso de uso sigue comprobando antes, para dar una
  respuesta clara en el caso habitual.
- Una escritura que solo anota que algo ha pasado (`lastUsedAt`) no es un cambio de la
  entidad: el repositorio la escribe con `table.patch(id, cambios)`, que no toca la
  versión, así que las peticiones en paralelo nunca chocan.
- Las filas que no son de ninguna entidad (una proyección, un índice de búsqueda, una
  tabla de enlaces que se reescribe entera, una purga) se escriben con
  `saveRows(write, { guard })`: en una transacción, bajo la regla de escritura y
  protegiendo lo que nombra. Un repositorio escribe con `save` o `saveRows`, nunca en
  una transacción propia; `table.patch`, arriba, es la única excepción.

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.repository.ts
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.saveRows(async () => {
      await this.base.db.deleteFrom('board').where('workspaceId', '=', workspaceId).execute()
    })
  }
  ```
- **Un valor que muchos cambian a la vez (un stock, un saldo, un contador) no es un
  campo que se lee y se guarda sin más**: cada cambio chocaría con los demás. O es lo
  que suman unas filas que solo se insertan (un módulo de movimientos), o cada cambio lo
  toma dentro del guardado, en `before`, bajo un `guard`, para que se turnen en vez de
  chocar. Los números de las tarjetas de cooper son lo segundo: cada tablero guarda el
  último número que dio en una fila de `card_counter`, que una tarjeta nueva sube en
  uno dentro de su propio guardado, bajo `boardCards:<board>`; nunca baja, así que el
  número de una tarjeta borrada no se vuelve a dar.

## Casos de uso

- Cada método público de un módulo es un caso de uso, marcado con `@UseCase()`. Se
  llama como su módulo y él mismo (`list` de `board` es `board.list`), y cada llamada
  es una invocación: un span de la traza, dentro del de quien lo llama cuando lo llama
  otro caso de uso. No abre ninguna transacción: cada `persist` es una.
- Valida la entrada en la puerta: `<M>CreateSchema.parse(input)`.
- Forma: validar → cargar → decidir → cambiar la entidad → `persist` → devolver DTOs.
  Guardar una vez, al final. Cuando un caso de uso no puede evitar guardar en pasos (o
  llamar a otro contexto), pon primero lo que pueda fallar, y haz que cada paso se
  pueda repetir sin problema.

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  @UseCase()
  async update(id: string, input: BoardUpdateDTO): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(BoardName.from(changes.name), id)
    board.update(changes)
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }
  ```
- **Ninguna lista se devuelve entera salvo que una regla del dominio la acote** (como
  mucho 10 columnas, `MAX_COLUMNS`; 500 cards, `MAX_CARDS`); las demás van por
  páginas. Un caso de uso que lista recibe un
  `PageRequest` (`size`, `cursor`) y devuelve un `Page` (`items`, `hasMore`, `total`).
  El cursor es el id del último elemento mostrado: los ids son v7, así que se ordenan
  por tiempo. `TableRepository.page` lo hace todo; las rutas leen la página con
  `pageRequestFrom(request)` (`?size` de 1 a 100, 20 por defecto, y `?cursor`). La
  página de entidades se convierte en una página de DTOs escrita campo a campo, para
  que se lea como lo que es:

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  const found = await this.repo.page({}, page, { newestFirst: true })
  return {
    items: found.items.map(board => board.toDTO()),
    hasMore: found.hasMore,
    total: found.total,
  }
  ```

  Una lista que el dominio acota puede venir entera, y dice por qué (las columnas de
  un tablero, como mucho diez).
- **Un flujo que pasa por varios módulos puede fallar a mitad**, porque cada paso es
  su propia transacción. Converge porque cada paso es idempotente y el trabajo de un
  worker se repite hasta completarse. Cuando otro camino puede detener el flujo, cada
  paso hecho tiene su **compensación**, un paso que lo deshace, ejecutado desde un
  worker con el evento que detiene el flujo: una saga. (El borrado de un espacio de
  trabajo de cooper converge así: `tenant.delete` retira él mismo los accesos del
  espacio justo después de guardar el borrado, para que nadie entre desde el momento en
  que responde; después `tenant.deleted` pone en marcha `tenant.removeAccesses` en
  auth, por si ese segundo guardado falló (la pertenencia de boards pregunta también
  si el tenant sigue ahí, así que mientras tanto no entra nadie), y `workspace.purge` y
  `activity.purgeWorkspace` en boards, cada uno un trabajo que se repite hasta
  completarse.) Un trabajo que agota sus intentos es un flujo
  atascado a mitad: alguien tiene que mirarlo, arreglar la causa y relanzarlo con
  `store.outbox.retry(id)`. cooper da a cada contexto un pequeño `Outbox_Module`
  (`shared/outbox`) cuyos casos de uso `dead(page)` y `retry(id)` listan y relanzan sus
  trabajos muertos, y su backoffice se los enseña al staff, los de cada contexto a
  través de los casos de uso de ese contexto.
- Para convertir un `find` en un elemento o un error, usa `this.resolve(find,
  onMissing)` de `Module`: quien llama elige el error (404 cuando el id es el propio
  recurso, 400 cuando es una referencia dentro de la entrada).

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }
  ```

  `this.resolveRefs` convierte los ids de una entrada en referencias con nombre, o en
  un `ReferenceNotFound`.
- **Lo que solo puede hacer su dueño toma el actor, no un id**: `tenant.create` hace
  admin a quien ha iniciado sesión con `currentActor().userId`; ningún cliente envía
  quién es.

## Eventos

- Nombre: `<módulo>.<verbo en pasado>` (`card.assigned`), clase `<M>_<Verbo>`
  (`Card_Assigned`, con un `eventName` estático), fichero `events/<m>-<verbo>.ts`.

  ```ts
  // cooper/backend/contexts/boards/modules/board/events/board-updated.ts
  type BoardChange = { dto: BoardDTO, changes: Partial<BoardDTO>, previous: Partial<BoardDTO> }

  export class Board_Updated implements DomainEvent<BoardChange> {
    static readonly eventName = 'board.updated'
    readonly name = Board_Updated.eventName
    readonly occurredAt = new Date().toISOString()
    constructor(readonly payload: BoardChange) {}
  }
  ```
- Contenido: `created` y `deleted` llevan el DTO; `updated` lleva `{ dto, changes,
  previous }`: el DTO entero, los campos que cambiaron y lo que valían antes. La
  transición de cada campo es `previous[campo]` → `changes[campo]`. Un evento de un
  tipo propio lleva lo que necesitan quienes lo escuchan (`card.assigned`:
  `{ dto, previousAssigneeId }`). El contenido es JSON (`DomainEvent<T extends Json>`),
  tal como un `handler` lo recupera de su trabajo guardado: una fecha viaja como su
  texto ISO, y el contenido es un `type`, no una `interface` (que TypeScript no acepta
  como JSON).
- **Un evento se publica después de confirmar el guardado que lo registró.** Un
  guardado que se deshace no publica nada.
- Los eventos salen de las entidades, a través de su repositorio. Algo que no es de
  una entidad puede publicar uno en `base.bus`, con las mismas garantías: sus trabajos
  en la transacción en curso, sus handlers `fire-and-forget` después de confirmarla.
- Cada módulo ofrece sus eventos en `events`, hechos con `eventsOf`:

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  ```
- Las reacciones viven en `<m>.workers.ts`, siempre igual: el módulo que reacciona se
  suscribe al evento del otro, `deps.<módulo>.events.<evento>.subscribe(fn, opts)`, y
  `opts.strategy` dice cómo. Cada estrategia está tipada con lo que admite:
  - **`'handler'`, de forma duradera**: se escribe un trabajo en el outbox, en la
    transacción del cambio, así que se guardan los dos o ninguno; un worker lo ejecuta
    después de confirmar, y de nuevo, con espera creciente, si falla, hasta que agota
    sus intentos (5, o `attempts`). Nombra su `queue`, completa: `<módulo que
    reacciona>.<caso de uso>.on.<módulo que avisa>.<evento>`. El emisor rechaza una
    cola que no termine en su propio evento.

    ```ts
    // cooper/backend/contexts/boards/modules/card/card.workers.ts
    cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), {
      strategy: 'handler',
      queue: 'card.notifyAssignee.on.card.assigned',
    })

    deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
      strategy: 'handler',
      queue: 'card.leaveRemovedColumn.on.column.removed',
    })

    deps.access.revoked.subscribe(access => cards.unassignMember(access.tenantId, access.userId), {
      strategy: 'handler',
      queue: 'card.unassignMember.on.access.revoked',
      when: (access: RevokedAccess): access is RevokedAccess & { tenantId: string } => access.productId === WORKSPACES_PRODUCT && access.tenantId !== null,
    })
    ```

    El callback solo llama a un caso de uso del módulo que reacciona, con lo que toma
    del evento. Qué eventos toma (un acceso a un espacio de trabajo, no al backoffice)
    lo dice `when`, nunca lógica de negocio: mira el payload en la transacción del
    guardado que cuenta el evento, antes de escribir ningún trabajo, así que un evento
    que no toma no deja trabajo. Un type guard, con su parámetro tipado, estrecha lo que
    recibe el callback. `fire-and-forget` también acepta `when`. Renombrar la
    cola deja los trabajos pendientes con el nombre antiguo; el worker lo comprueba al
    arrancar y cada minuto después, y avisa una vez de una cola con trabajos que ningún
    worker atiende desde hace cinco minutos (unos minutos después de un despliegue,
    porque hasta entonces la atendía el proceso anterior).
  - **`'fire-and-forget'`, en memoria**: se ejecuta después de confirmar, y se pierde
    si falla o si el proceso se para. Para lo que se puede perder: una caché, una
    línea de log, un email cuyo contenido no debe guardarse nunca. No lleva cola.

    ```ts
    // cooper/backend/contexts/boards/modules/activity/activity.workers.ts
    events.moved.subscribe(({ dto, previous, by, via }) => {
      options.log(`[boards] #${dto.number} "${dto.title}" moved from column ${previous.columnId} to ${dto.columnId} by ${by ?? 'cooper'}${via ? ` (${via})` : ''}`)
    }, { strategy: 'fire-and-forget' })
    ```

    El mismo evento tiene también un `handler`, que apunta el movimiento en la
    actividad de la tarjeta: lo que tiene que durar va por el outbox, lo que se puede
    perder no.
- Un handler se ejecuta sin actor, nunca con el de quien publicó, y fuera de todo
  ámbito: `currentActor()` lanza `NoActor` dentro de él, así que lo que necesite lo lee
  del evento, o pone uno él mismo con `runAsActor` (o entra en un ámbito, como hacen
  los workers de cooper con `runInWorkspace`). Llama a un caso de uso de su propio
  módulo, que es el único sitio desde el que puede escribir en otro módulo (ver
  [Cómo hablan los módulos](#como-hablan-los-modulos)). Puede ejecutarse más de una
  vez: es idempotente.
- Un handler recibe el payload y lo demás que se sabe del evento:
  `subscribe((payload, event) => …)`, siendo `event` su `id`, su `name` y su
  `occurredAt`. El publicador da a cada evento su id, el mismo para cada uno de sus
  handlers y cada ejecución de sus trabajos: aquello en lo que se apoya un handler que
  debe hacer algo una sola vez por evento (el registro de actividad de cooper lo toma
  como id de cada entrada).

  ```ts
  // cooper/backend/contexts/boards/modules/activity/activity.workers.ts
  events.created.subscribe((card, event) => activity.recordCreated(card, event), { strategy: 'handler', queue: 'activity.recordCreated.on.card.created' })
  ```
- **Lo que no se puede deshacer sale de un worker, nunca de un caso de uso**: un email
  se envía después del evento de aquello de lo que trata, así que solo por lo que se
  ha guardado (el `card.notifyAssignee` de cooper, con `card.created` y
  `card.assigned`).
- **La forma de un evento solo crece.** Sus trabajos lo guardan tal como se publicó, y
  pueden ejecutarse después de un despliegue con el código de entonces: un evento solo
  gana campos opcionales. Un cambio que rompe su forma viene con una migración que
  reescribe sus trabajos pendientes.
- **Lo que toca a una hora es una programación** (`schedule`), un evento que el
  contexto cuenta cuando lo dice una expresión cron (cinco campos, en UTC):
  `base.schedules.define('report.nightly', '0 3 * * *')` da su emisor, que un módulo
  ofrece como ofrece sus eventos, y los demás se suscriben a él como a cualquier
  evento, con un `handler` (un trabajo del outbox, que se reintenta hasta que sale) o
  `fire-and-forget`. El payload es `{ dueAt }`. Cada tic se cuenta una vez, por muchos
  procesos que ejecuten el contexto: lo cuenta el primero que lo apunta en la tabla
  `schedule_tick` del store, con los trabajos de sus handlers en la misma transacción.
  Los tics perdidos mientras no corría ningún proceso se cuentan como uno, el último;
  una programación que se ve por primera vez espera a su siguiente tic. Las
  programaciones arrancan y paran con los trabajos del contexto; un test que ha movido
  su reloj llama a `base.schedules.tick()`.

## Errores y lo que dicen

Los errores de dominio viven en `errors/` del módulo, una clase cada uno, con un
`code` estable (`board.not_found`). Extienden una base, que decide el estado HTTP:

```ts
// cooper/backend/contexts/boards/modules/board/errors/board-not-found.ts
export class BoardNotFound extends NotFoundError {
  readonly code = 'board.not_found'
  constructor(id: string) {
    super(`There is no board ${id}`)
  }
}
```

| Base | Estado | Cuándo |
|---|---|---|
| `NotFoundError` | 404 | el propio recurso pedido no existe |
| `ValidationError` | 400 | la entrada está mal |
| `ReferenceNotFound` | 400 | un id **dentro** de la entrada no apunta a nada |
| `UnauthorizedError` | 401 | nadie ha iniciado sesión, o las credenciales están mal |
| `ForbiddenError` | 403 | quien lo pide no puede hacerlo |
| `ConflictError` | 409 | el estado actual no lo permite |
| `ConcurrencyConflict` | 409 | alguien lo guardó después de leerlo |

Todos extienden `DomainError` (`status`, `code`, `message`). Un error de dominio es una
respuesta, no un fallo: no marca como fallido el span de su caso de uso.

Los errores propios del framework hablan un inglés llano, para quien desarrolla. Una
aplicación sustituye sus mensajes una vez, al arrancar, para todo el proceso: con sus
propias palabras, o en otro idioma. Solo cambia el mensaje; el `code` y el estado se
quedan. cooper lo hace en `index.ts`, antes de abrir nada:

```ts
// cooper/backend/shared/messages.ts
export const cooperMessages: Partial<Messages> = {
  concurrency_conflict: () => 'Someone else changed this a moment ago. Reload it and try again.',
  reference_not_found: ({ resource, id }) => `That ${resource} is not there any more (${id})`,
  not_signed_in: () => 'You are not signed in, or your session has ended: sign in to go on',
  validation: () => 'Some of what was sent is not right: check the fields and try again',
  route_not_found: ({ method, path }) => `Cooper has nothing at ${method} ${path}`,
  internal: () => 'Something went wrong on our side. Try again in a moment.',
}

// …
export function setCooperMessages(): void {
  setMessages(cooperMessages)
}
```

Como es de todo el proceso, se prueba en un proceso propio (el `messages.test.ts` de
cooper lo ejecuta con `Bun.spawn`): fijado en un test, cambiaría lo que leen todos los
demás tests de ese proceso.

Sus códigos son `concurrency_conflict`, `reference_not_found`, `not_signed_in`,
`invalid_email`, `invalid_secret_token`, `route_not_found`, `method_not_allowed`,
`validation`, `malformed_body`, `unsupported_media_type`, `filter_too_deep`,
`filter_too_many_conditions` e `internal`.

Un endpoint OAuth responde en el formato de OAuth, `{ error, error_description }`:
`toOauthErrorResponse(error, fallback, codes)`, de `newt/http`, traduce el código de
cada error de dominio a uno de OAuth.

## Value objects

Un valor con reglas propias (cómo se escribe, se compara o se crea) es un value
object, definido una vez: un tipo y una constante con el mismo nombre.

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
export type BoardName = string & z.$brand<'BoardName'>

export const BoardName = {
  /** How it is kept: what `from` makes of what someone typed. */
  schema: z.string()
    .min(1)
    .max(MAX_LENGTH)
    .refine(name => name === tidy(name), 'A board\'s name has no spaces around it, nor two in a row')
    .brand<'BoardName'>(),
  from(value: string): BoardName {
    const name = tidy(value)
    if (name.length === 0 || name.length > MAX_LENGTH) throw new InvalidBoardName(value)
    return name as BoardName
  },
} satisfies ValueObject<BoardName, string>
```

- **Su tipo lleva marca** (*brand*): en ejecución un `BoardName` es un string, pero
  para el compilador un string cualquiera no es un `BoardName` hasta que pasa por
  `BoardName.from` (lo que alguien ha escrito) o `BoardName.schema` (lo que estaba
  guardado). A una función que recibe uno no se le puede pasar por error un string sin
  comprobar.
- El framework trae `Email` (recortado y en minúsculas, hasta 254 caracteres; un
  `InvalidEmail` es un 400) y `SecretToken` (32 bytes aleatorios en base64url, con
  `generate()` y `hash(token)`; un `InvalidSecretToken` es un 400). El esquema de la
  entidad usa `X.schema`; un esquema de entrada sigue siendo flexible (un `z.email()`
  normal), y la entidad o el caso de uso lo pasa por `X.from` antes de guardarlo.

  ```ts
  // cooper/backend/contexts/auth/modules/user/user.schema.ts
  export const UserSchema = z.object({
    id: z.uuidv7(),
    email: Email.schema,
    // …
  })

  export const UserSignUpSchema = z.object({
    email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
    // …
  })
  ```
- **Donde los valores vuelven del almacenamiento, di ahí su tipo**: un tipo de fila
  dice `email: Email` (y también el tipo de tabla que se le da a Kysely). Nada más
  necesita un cast.
- Un string de fuera que debe ser uno (un token de una cookie) se comprueba con
  `X.schema.safeParse(valor)`, y su `data` es el valor.

## Datos

- **Los ids son UUIDv7**, y los da `Entity`. Nunca pases un id en la entrada de una
  creación: la paginación por id depende de que los v7 se ordenen por tiempo.
- **La fila de cada entidad tiene una `version`**, que los guardados comprueban y
  avanzan.
- **El borrado lógico** (`softDelete: true`) conserva la fila borrada con su
  `deletedAt`, y la deja fuera de cualquier búsqueda. Un valor único debería serlo
  entre las filas no borradas: en SQLite, un índice único parcial.

  ```sql
  -- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
  CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
  ```
- No diseñes alrededor del store: primero la entidad y los casos de uso; las tablas
  los siguen.

## Analítica

Los datos pensados para leerse en grandes cantidades de una vez (tarjetas creadas por
día, por espacio de trabajo) van a una base de datos analítica a través del puerto
`Analytics` (`newt/port-analytics`): solo se le añaden filas, nunca se cambian
(`append(dataset, rows)`). No tiene transacciones, así que la alimentan workers
`handler` después de los eventos de lo que guardó el store; cada fila lleva un id
propio (el del evento, el de la tarjeta), de modo que un trabajo que se ejecuta dos
veces no añade nada. Se lee con el lenguaje de consulta de cada adaptador. El
framework aún no trae ningún adaptador; `MemoryAnalytics` (en
`newt/port-analytics/contract`) es el de los tests, y `describeAnalyticsContract`
comprueba uno nuevo. cooper escribe uno pequeño sobre SQLite
(`shared/analytics/sqlite-analytics.ts`, en la base de datos del propio backoffice),
declara las lecturas que necesita en una interfaz suya, y lo alimenta con workers
`handler` sobre los eventos de auth y de boards, cada fila con el id de lo que cuenta:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.workers.ts
deps.card.events.created.subscribe(card => metrics.recordCard(card), {
  strategy: 'handler',
  queue: 'metric.recordCard.on.card.created',
})
```

## Observabilidad

Cada contexto puede dar a su `Base` un `Tracer` (`new BoardsBase({ name, store, tracer
})`): cada llamada a un caso de uso es un span, con su nombre, con el contexto, el
módulo y el caso de uso como atributos, hijo del de quien lo llama, marcado con el
error cuando se escapa uno que no es de dominio, y con un evento (`conflict.retry`)
por cada reintento ante un conflicto. Los pasos del propio worker de trabajos también
son spans. Sin tracer, no se registra nada (`NoopTracer`).

Da el **mismo** tracer a todos los contextos de un proceso. El span activo viaja con el
trabajo, así que un caso de uso de un contexto al que llama otro cae dentro del span de
quien lo llama: una sola traza para toda la petición, entre contextos. cooper crea un
`ConsoleTracer` (`shared/observability`) cuando `COOPER_TRACE=1` y se lo da a los tres
(mira `open-contexts.ts` más arriba); escribe cada traza cuando termina, y deja fuera
los spans `job.…` del worker.
