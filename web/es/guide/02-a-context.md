# Un contexto y su base

Un **contexto** es una parte de la aplicación con sus propios datos, sus propios
módulos y su propio servidor. cooper tiene tres: `auth`, `boards` y `backoffice`. Este
capítulo construye aquello sobre lo que se apoya cada uno: la base que reciben sus
módulos, el contexto que los abre, su configuración y el programa que los arranca y
los para a todos.

## Por qué tres, y no uno

Podrías meter las cuentas, los tableros y la consola del personal en un solo contexto.
Compartirían una base de datos y un servidor, y cualquier módulo podría leer cualquier
tabla. Funcionaría durante un tiempo.

Después las piezas empiezan a tirar cada una por su lado. Las cuentas y OAuth cambian
poco y no pueden romperse nunca; los tableros cambian cada semana. La consola del
personal lo lee todo, y solo debe cambiar las cosas como las cambiarían las propias
apps. Y todas las apps que inician sesión a través de `auth` deberían hacerlo igual,
desde fuera, como cualquier otro cliente OAuth.

Así que cooper traza una línea alrededor de cada parte:

- **Cada contexto tiene su propio store** (un fichero SQLite), sus propios módulos y
  su propio servidor, en su puerto y, en producción, en su dominio.
- **Los contextos dependen entre sí sin ciclos.** `auth` no usa ninguno; `boards` usa
  `auth`; `backoffice` usa los dos. Cada uno se abre después de los que usa, y recibe
  sus módulos.
- **Un contexto llega a otro solo por sus casos de uso y sus eventos**, nunca por su
  store. `boards` pregunta a `auth` "¿es Bob miembro de Acme?" llamando a un caso de
  uso, nunca leyendo las tablas de `auth`.

El lint vigila la segunda regla (capítulo [1](./01-the-project)). La tercera la vigilan
los tipos: a un contexto nunca se le da otro contexto, solo los módulos que usa de él,
y esos módulos tienen casos de uso y eventos, nunca un store. Esto es lo que recibe
`backoffice`:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
/**
 * What `backoffice`'s modules are given besides its base: the use cases of the
 * contexts it reads, those it needs and nothing else. Never a context's base nor its
 * store: another context is reached through its use cases and its events.
 */
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
  boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
}
```

Un `Pick` de los `modules` del otro contexto: `backoffice` puede llamar a los casos de
uso de `boards.card`, y no tiene forma de llegar a `boards.base.store`, ni siquiera a
`boards.column`. Lo que usa de cada contexto está escrito en un solo sitio, y
ampliarlo es una decisión que se ve en un diff. El capítulo
[19](./19-several-contexts) trata de cómo hablan los contextos.

## La base: lo que recibe cada módulo

Cada módulo, al crearse, recibe la **base** de su contexto. En ella encuentra todo lo
que necesita: el store donde se guardan los datos, el bus de eventos, la cola de
trabajos de los workers y las invocaciones de sus casos de uso.

newt te da una `Base`. Tu aplicación la amplía con lo que quiera darles a sus módulos.
cooper les da un router, donde cada módulo registra sus rutas:

```ts
// cooper/backend/shared/cooper-base.ts
import { Base } from 'newt/runtime'
import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'

/**
 * What every module of cooper receives: newt's base, on SQLite, with the router its
 * context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
```

`Base<SqliteStore>` dice que los módulos de cooper funcionan sobre SQLite. Una base
también puede ser `Base<Store>`, que dice que los módulos funcionan con **cualquier**
store: ficheros, SQLite, Postgres, MySQL. Es la mejor opción mientras ningún módulo
necesite más. cooper sí necesita más: `boards` escribe algunas consultas con Kysely, y
Kysely necesita un store SQL. Así que su base lo dice:

```ts
// cooper/backend/contexts/boards/boards-base.ts
import { kyselyFor } from 'newt/kysely'
import { CooperBase } from '../../shared/cooper-base'
import type { BoardsDatabase } from './boards-database'

/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (counts by workspace, a search in the text of the
 * cards). Kysely needs a SQL store: `boards` opens on SQLite, and would open on
 * Postgres or MySQL the same way, never on files.
 */
export class BoardsBase extends CooperBase {
  readonly db = kyselyFor<BoardsDatabase>(this.store)
}
```

Cada contexto puede ampliar la base compartida con lo que solo necesitan sus módulos.
`auth` añade un segundo router para los endpoints de OAuth, que viven fuera de `/api`
(capítulo [20](./20-oauth-server)).

## Un contexto que se sirve a sí mismo

El `BoundedContext` de newt es un nombre y una base, con `start()` y `stop()`. Cada
contexto de cooper, además, se sirve a sí mismo en un puerto. Esa parte es igual en
los tres, así que vive en `shared/`:

```ts
// cooper/backend/shared/served-context.ts
import type { Server } from 'bun'
import { BoundedContext } from 'newt/runtime'
import { serve } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
  /** The built frontend it hands out for every address its routes do not take. */
  frontendFolder: string
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain, so its sessions (cookies) are its own too. It answers `GET /api/health`
 * without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
    base.http.get('/health', () => Response.json({ status: 'ok', context: name }), { public: true })
  }

  /** What its server answers besides its modules' API: an MCP entry, a `/.well-known` document. */
  protected routes(): Bun.Serve.Routes<undefined, string> {
    return {}
  }

  /** Its server: its modules' API, what it adds, and its frontend for any other address. */
  serve(): Server<undefined> {
    return serve({ port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder })
  }
}
```

`serve`, de `newt/http`, convierte el router en un `Bun.serve`: todas las rutas del
router bajo `/api`, las `routes` extra a su lado, y el frontend compilado para
cualquier otra dirección. `{ public: true }` deja que una ruta responda sin nadie con
sesión; todas las demás exigen un actor (capítulo [5](./05-who-and-where)).

## El contexto

El contexto abre su store, crea la base, inicializa los módulos y sabe servirse. Este
es `boards`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Tracer } from 'newt/core'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_Auth, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'
import { mcpRoutes } from './mcp/mcp'

export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config, private readonly auth: Boards_Auth) {
    super('boards', base, config)
  }

  /** Opened after `auth`, which it uses; watched by `tracer`, if one is given. */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, tracer?: Tracer): Promise<Boards_Context> {
    const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
    const base = new BoardsBase({ name: 'boards', store, tracer })
    return new Boards_Context(base, initializeModules(base, config, deps), config, deps.auth)
  }

  /** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
  }
}
```

Lo que conviene observar:

- **`SqliteStore.open`** abre el fichero de la base de datos (y lo crea si no existe),
  y aplica las migraciones SQL de `migrations/` que aún no había aplicado. Cuando
  `open` vuelve, las tablas están al día, antes de que ningún módulo las lea. El
  capítulo [24](./24-migrations) trata de las migraciones.
- **`open` recibe `deps`**: lo que `boards` necesita de fuera, los casos de uso de
  `auth` entre ello. Se lo da quien abre el contexto. Así un contexto recibe los que
  usa sin importar cómo se abren.
- **`tracer`** es opcional: si se le da, la base le informa de cada caso de uso que
  ejecuta (más abajo).
- **`initializeModules`** crea los módulos, cada uno después de los que usa:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  // Its people sign in through auth: boards is the OAuth client of the product `cooper`.
  const session = WebSession_Module.initialize(base, { /* … */ })
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  // …
  return { session, member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

El objeto que devuelve son los `modules` del contexto: `boards.modules.board.create(…)`
es como un script, un test u otro contexto llaman a un caso de uso. Añadirás `board` a
esta lista al final del capítulo siguiente.

## Su configuración

Un contexto necesita saber dónde escuchar, dónde está su base de datos y desde dónde
lo abre la gente. cooper lo lee todo de variables de entorno en un solo fichero, con
lo que necesita el desarrollo por defecto:

```ts
// cooper/backend/config.ts
const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

const env = process.env
// …
export const config = {
  // …
  /** The SaaS: workspaces' boards, columns and cards, on the web and through MCP. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DB_PATH`: its database file. */
    dbPath: fromRoot(env.COOPER_BOARDS_DB_PATH ?? 'data/cooper-boards.db'),
    publicUrl: publicUrls.boards,
    /** Where its people sign in. */
    authPublicUrl: publicUrls.auth,
    /** Its OAuth client's secret: boards is the product `cooper` in auth. */
    clientSecret: clientSecrets.cooper,
    sessionDays,
    /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND ?? 'dist/cooper/boards'),
  },
  // … auth and backoffice, the same way
}

export type Config = typeof config
```

Cada contexto toma su parte, y nada más:

```ts
// cooper/backend/contexts/boards/boards-config.ts
import type { Config } from '../../config'

/** The settings of `boards`, from `config.ts`. */
export type Boards_Config = Config['boards']
```

Bun carga `.env` por su cuenta, así que basta un fichero `.env` en la raíz para
cambiar cualquiera de ellas en tu máquina. Un contexto nunca lee `process.env`: recibe
su configuración. Eso es lo que permite a un test abrirlo con `dbPath: ':memory:'` y
`port: 0`.

## Abrirlos todos, en orden

`open-contexts.ts` abre los tres, cada uno después de los que usa, y le da a cada uno
los que necesita:

```ts
// cooper/backend/open-contexts.ts
/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`, then `backoffice`, which reads both. The
 * server opens them, and so does any script that works with their modules (the seed).
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  // One tracer for every context: a use case that calls another context's shows that
  // call inside it, since they run in one process.
  const tracer = options.tracer ?? (config.trace ? new ConsoleTracer() : undefined)
  const auth = await Auth_Context.open(config.auth, { mailer }, tracer)
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, log: tracer && (line => console.log(line)) }, tracer)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, tracer)
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}

// …

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
```

`boardsOnAuth(auth)` convierte los casos de uso y los eventos de `auth` en lo que
`boards` pide, con las palabras de `boards` ("¿es esta persona miembro de este
workspace?"). El capítulo [19](./19-several-contexts) lo enseña entero. `backoffice`
recibe `auth.modules` y `boards.modules`, con el tipo de los `Pick` que declaró: su
código solo llega a lo que eligió. De momento, fíjate en el orden: `auth` se abre
primero porque `boards` lo necesita para abrirse, y se para el último por lo mismo.

El tracer es uno para los tres. Con `COOPER_TRACE=1`, cada caso de uso que ejecuta
cualquier contexto se escribe en la consola al acabar, con los casos de uso a los que
llamó dentro y lo que tardó cada uno. Los contextos corren en un mismo proceso, así que
cuando un caso de uso de `boards` llama a uno de `auth`, el segundo sale dentro del
primero: un tracer por contexto partiría esa traza en dos. Un test puede pasar el suyo
(`options.tracer`) para leer esa traza. El capítulo [22](./22-backoffice) enseña lo
que escribe.

## Arrancar y parar

El programa es corto. Abre los contextos, sirve cada uno en su puerto, arranca sus
workers y se para limpiamente con una señal:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running.
import { config } from './config'
import { openContexts, stopContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

const servers = contexts.all.map(context => {
  const server = context.serve()
  console.log(`${context.name} listening on ${server.url}`)
  return server
})
for (const context of contexts.all) context.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
    process.exit(0)
  })
}
```

- **Antes de nada**, `setCooperMessages()` pone los mensajes de error propios de newt
  con las palabras que quiere cooper. El capítulo [3](./03-first-module) lo enseña.
- **Al arrancar**, cada contexto abre (y migra) su store, sirve, y `context.start()`
  arranca el bucle que ejecuta sus workers, en este mismo proceso.
- **Al parar** (`SIGINT`, `SIGTERM`), primero los servidores dejan de aceptar
  peticiones. Después `context.stop()` espera a los workers que están en marcha y
  cierra el store. Un reinicio nunca corta un trabajo a la mitad; lo que quedaba
  pendiente sigue pendiente, y se ejecuta cuando el proceso vuelve.

El framework también avisa si hay trabajos esperando en una cola que ningún worker
atiende desde hace cinco minutos: casi siempre, un caso de uso o un módulo que se ha
renombrado (capítulo [11](./11-reacting)).

## Por qué SQLite

Un contexto guarda sus datos en un **store**. newt tiene cuatro, y un módulo que solo
usa tablas y criterios funciona en cualquiera:

| | Ficheros | SQLite | Postgres y MySQL |
|---|---|---|---|
| **Qué es** | Un JSON por registro, en carpetas. | Una base de datos SQLite, en un fichero. | Un servidor de base de datos. |
| **Instalar** | Nada. | Nada (viene con Bun). | El servidor; el driver viene con Bun. |
| **Tamaño** | Miles de registros. | Millones. | Millones, y varias máquinas. |
| **Transacciones** | Una cada vez. | Una cada vez. | Muchas a la vez. |
| **Estructura** | No hay: cada tabla es una carpeta. | Migraciones SQL. | Migraciones SQL, en su dialecto. |

cooper usa SQLite: nada que instalar, SQL de verdad (que necesitan Kysely y las
migraciones) y suficiente para producción en una máquina. Cada contexto tiene su
fichero: `data/cooper-auth.db`, `data/cooper-boards.db`, `data/cooper-backoffice.db`.

Para los tests, `:memory:` abre una base de datos que vive hasta que se cierra, y que
se comporta exactamente igual que una en disco. El capítulo
[26](./26-production) cuenta qué cambia en Postgres o MySQL.

## Comprobarlo

Arranca solo el backend y pregúntale a `boards` si está en marcha:

```bash
bun cooper/backend/index.ts
```

```
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
backoffice listening on http://localhost:3003/
```

```bash
curl -s localhost:3002/api/health
```

```json
{"status":"ok","context":"boards"}
```

Cualquier otra ruta de la API necesita a alguien con sesión:

```bash
curl -s localhost:3002/api/workspaces/x/boards
```

```json
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

El test de cooper hace lo mismo con los tres contextos, cada base de datos en memoria
y cada servidor en un puerto libre:

```ts
// cooper/backend/open-contexts.test.ts
/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, dbPath: ':memory:', port: 0 },
    boards: { ...config.boards, dbPath: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, dbPath: ':memory:', port: 0 },
  }
}

test('opens the three contexts, serves each on its own port, and stops them', async () => {
  const mails: Mail[] = []
  const contexts = await openContexts(testConfig(), { mailer: { send: async mail => { mails.push(mail) } } })
  expect(contexts.all.map(context => context.name)).toEqual(['auth', 'boards', 'backoffice'])

  const servers = contexts.all.map(context => context.serve())
  for (const context of contexts.all) context.start()
  try {
    expect(new Set(servers.map(server => server.port)).size).toBe(3)
    for (const [index, context] of contexts.all.entries()) {
      const response = await fetch(new URL('/api/health', servers[index]!.url))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok', context: context.name })
    }
    // …
  } finally {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
  }
  // …
})
```

## En resumen

- Un contexto tiene su propio store, sus módulos y su servidor. Los contextos dependen
  entre sí sin ciclos, y llegan unos a otros solo por casos de uso y eventos: dale a
  un contexto un `Pick` de los `modules` del otro, nunca el contexto.
- La base es lo que recibe cada módulo. Amplía la `Base` de newt con lo que necesiten
  tus módulos (un router, Kysely), y dale el tipo del store que de verdad necesitan:
  `Base<Store>` si les vale cualquiera.
- El contexto abre su store (que se migra al abrirse), crea la base e inicializa sus
  módulos, cada uno después de los que usa. Recibe su configuración y los contextos que
  usa; nunca lee el entorno.
- Abre los contextos en orden de dependencias y páralos al revés. Con una señal: para
  los servidores, y luego `context.stop()`, que espera a los workers.
