# El backoffice

El equipo de cooper necesita su propia consola: todos los espacios de trabajo, todas
las cuentas, quién es del staff y unos cuantos números sobre cómo se usa cooper. Nada de
eso pertenece a un espacio de trabajo, y nada son datos nuevos: auth guarda las cuentas
y los espacios, y boards lo que hay dentro. En este capítulo construyes `backoffice`, el
tercer contexto. Casi no guarda nada: monta cada pantalla con los casos de uso de los
contextos que saben.

Por el camino verás cuatro cosas que newt te da para una consola así: un acceso sin
tenant, Kysely para los recuentos que una tabla no sabe decir, el puerto de analítica
para las métricas y un tracer para ver qué hizo una petición.

(La interfaz del backoffice está en `cooper/frontend/backoffice`. Esta guía no la trata.)

## El staff: un acceso sin tenant

En auth, un acceso dice quién puede entrar en qué producto y para qué tenant. Un
miembro de Acme tiene acceso al producto `cooper` para el tenant Acme. Alguien del
staff tiene acceso al producto `backoffice` para **ningún tenant**: su `tenantId` es
`null`. El staff mira todo cooper, no un espacio de trabajo.

El backoffice es un producto de auth, con su propio cliente OAuth, como boards:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
/** The backoffice as a product of auth's: its OAuth client, and what its staff have access to. */
export const BACKOFFICE_PRODUCT = 'backoffice'
```

Su módulo `staff` no guarda nada. Para saber si alguien es del staff, se lo pregunta a
auth cada vez:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.module.ts
/**
 * The signed-in person is of the staff, or nothing of the backoffice answers them:
 * what every route of its API checks first (`staffRoutes`).
 */
@UseCase()
async enter(): Promise<void> {
  if (!await this.isStaff(currentActor().userId)) throw new NotStaff()
}

// …

@UseCase()
async isStaff(userId: string): Promise<boolean> {
  return (await this.deps.access.check(userId, this.options.productId, null)) !== null
}
```

¿Por qué preguntar cada vez, y no guardar una marca en la sesión del backoffice? Porque
un acceso retirado tiene que contar al momento. Si la sesión recordara "staff" durante
30 días, alguien a quien sacan del staff conservaría la consola 30 días.

Hay dos comprobaciones, en dos sitios:

- **Al entrar, en auth.** El producto `backoffice` tiene `access: 'granted'`: auth no
  deja entrar a nadie sin acceso a él. Nunca llega a tener sesión.
- **En cada petición, en el backoffice.** `staff.enter` se ejecuta antes de cada ruta.
  Es lo que hace que una retirada cuente al momento para quien entró antes de ella.

## Un middleware para todas las rutas

Cada módulo del backoffice registra sus rutas en el mismo grupo, cuyo middleware llama a
`staff.enter`:

```ts
// cooper/backend/contexts/backoffice/staff-routes.ts
export function staffRoutes(base: CooperBase, staff: Staff_Module) {
  return base.http.group('', async (_request, next) => {
    await staff.enter()
    return next()
  })
}
```

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.routes.ts
export function registerWorkspaceRoutes(base: CooperBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `?name=acme`: a workspace's name, whole.
  routes.get('/workspaces', async request => {
    const name = new URL(request.url).searchParams.get('name') || undefined
    return Response.json(await workspaces.list({ name }, pageRequestFrom(request)))
  })

  routes.get('/workspaces/:workspaceId', async request => Response.json(await workspaces.get(request.params.workspaceId)))
  // …
}
```

El prefijo del grupo es `''`: el backoffice no tiene un ámbito como el espacio de
trabajo de boards ([capítulo 5](./05-who-and-where)), así que su grupo solo añade la
comprobación. Ningún caso de uso tiene que volver a hacerla, y ninguna ruta puede
olvidarla.

Las respuestas dependen de quién pregunta:

| Quién pregunta | Estado | Por qué |
|---|---|---|
| Nadie con sesión | 401 | El router rechaza toda ruta que no sea `public`. |
| Alguien con sesión que no es del staff | 403 | `NotStaff`, un `ForbiddenError`. |
| El staff, por algo que no existe | 404 | Un espacio o una cuenta que no existe. |

En boards, un espacio de trabajo al que no perteneces es un 404: decir "prohibido" le
contaría a un extraño que existe. El backoffice responde 403, y el error explica por
qué:

```ts
// cooper/backend/contexts/backoffice/modules/staff/errors/not-staff.ts
/**
 * Someone signed in who is not of the staff (any more). A 403, not a 404: the
 * backoffice is no secret to whoever signed in to it, and refusing them says nothing
 * of any workspace or account. What is inside is answered as usual: a workspace that
 * does not exist is a 404.
 */
export class NotStaff extends ForbiddenError {
  readonly code = 'staff.not_staff'
  constructor() {
    super('Only Cooper\'s staff may use the backoffice')
  }
}
```

El 403 llega antes de leer nada, en cualquier ruta. Así no revela qué espacios o
cuentas existen.

### Compruébalo

El test de la API del backoffice cambia el autenticador de la sesión por una cabecera
`x-user`, y pregunta a cada ruta sin sesión, como staff y como alguien a quien acaban
de retirar el acceso:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.test.ts
test('answers only the staff: 401 without a session, 403 to anyone else, at once after a revoke', async () => {
  const sam = await t.staffMember('Sam')
  const ana = await t.staffMember('Ana')

  for (const path of ['/api/session', '/api/workspaces', '/api/users', '/api/staff', '/api/metrics']) {
    expect((await get(path)).status).toBe(401)
    expect((await get(path, ana.id)).status).toBe(200)
  }
  expect(await (await get('/api/session', ana.id)).json()).toMatchObject({ user: { id: ana.id, name: 'Ana', email: 'ana@cooper.test' } })

  await t.as(sam, () => t.modules.staff.revoke(ana.id))
  for (const path of ['/api/session', '/api/workspaces', '/api/users/' + sam.id, '/api/staff', '/api/metrics']) {
    const response = await get(path, ana.id)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'staff.not_staff' })
  }
})
```

Y `backoffice-sign-in.test.ts` comprueba la otra mitad: auth no deja que alguien que no
es del staff acepte el backoffice (`oauthGrant.no_access`, un 403).

## Componer lecturas de dos contextos

La página de un espacio de trabajo en el backoffice muestra su nombre, su admin, cuántos
miembros y tableros tiene y cuántas cards. Eso son los tenants, accesos y cuentas de
auth, y los tableros y cards de boards. El módulo `workspace` del backoffice no es dueño
de nada de eso. Declara en sus deps los módulos que sí lo son:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.deps.ts
/**
 * What a workspace's page is made of, each part asked to the module that keeps it:
 * auth's tenants, accesses and accounts, and boards' boards and cards. Only their use
 * cases, never their repositories (ch. 23).
 */
export interface Workspace_Deps {
  /** That who asks is of the staff, before any route answers. */
  staff: Staff_Module
  tenant: Tenant_Module
  access: Access_Module
  user: AuthUser_Module
  board: Board_Module
  /** How many cards each workspace and board has: Kysely's counts, in boards (ch. 26). */
  card: Card_Module
}
```

El contexto se los pasa al inicializar sus módulos. auth y boards se abren antes, y el
backoffice los recibe:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
const workspace = Workspace_Module.initialize(base, { staff, tenant: auth.tenant, access: auth.access, user: auth.user, board: boards.board, card: boards.card })
```

Cada caso de uso son unas pocas llamadas a esos módulos, en paralelo cuando no dependen
unas de otras:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.module.ts
@UseCase()
async get(workspaceId: string): Promise<WorkspaceDetailDTO> {
  const tenant = await this.deps.tenant.get(workspaceId)
  const [[summary], members, boards] = await Promise.all([
    this.summaries([tenant]),
    this.deps.access.listForTenant(workspaceId, { size: 1 }),
    this.deps.board.listOf(workspaceId, { size: 1 }),
  ])
  return { ...summary!, members: members.total, boards: boards.total }
}
```

`tenant.get` va primero y solo: un espacio que no existe lanza el `TenantNotFound` de
auth, un 404, antes de que se ejecute nada más. Para contar miembros y tableros pide una
página de uno y lee su `total`. Ninguna lista se devuelve entera, tampoco a otro
contexto.

Una lista de espacios necesita, para cada uno, el nombre de su admin y su número de
cards. Pedirlos fila a fila serían tantas llamadas como espacios en la página. En su
lugar, el módulo pide una vez para toda la página:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.module.ts
/** Workspaces as the list shows them: two calls for the whole page, its admins and its cards. */
private async summaries(tenants: TenantDTO[]): Promise<WorkspaceSummaryDTO[]> {
  const [admins, counts] = await Promise.all([
    this.people(tenants.map(tenant => tenant.createdBy)),
    this.deps.card.countByWorkspace(tenants.map(tenant => tenant.id)),
  ])
  const cards = new Map(counts.map(count => [count.workspaceId, count.cards]))
  return tenants.map(tenant => ({
    id: tenant.id,
    name: tenant.name,
    createdAt: tenant.createdAt,
    admin: admins.get(tenant.createdBy) ?? null,
    cards: cards.get(tenant.id) ?? 0,
  }))
}

private async people(userIds: string[]): Promise<Map<string, PersonDTO>> {
  const users = await this.deps.user.getMany(userIds)
  return new Map(users.map(user => [user.id, { id: user.id, name: user.name, email: user.email }]))
}
```

Por eso auth ofrece `user.getMany` y boards ofrece `card.countByWorkspace` con una lista
de ids: un contexto del que otros leen ofrece sus lecturas por lotes.

### Escribir en auth

El backoffice también cambia cosas: hace a alguien del staff, o se lo quita. Lo hace
con los casos de uso de auth:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.module.ts
@UseCase()
async grant(input: StaffGrantDTO): Promise<StaffMemberDTO> {
  const { email } = StaffGrantSchema.parse(input)
  const user = await this.deps.user.findByEmail(email)
  if (!user) throw new StaffAccountNotFound(email)
  const access = await this.deps.access.grant({ userId: user.id, productId: this.options.productId, tenantId: null })
  return { id: access.id, userId: user.id, name: user.name, email: user.email, since: access.createdAt }
}
```

Esto no es escribir en otro módulo fuera de un worker. La regla de escritura es por
contexto ([capítulo 17](./17-modules-talk)): un caso de uso al que llama otro contexto es
la API de ese contexto, la raíz de lo que pasa en él. `access.grant` es el primer caso de
uso de su cadena en auth, y auth comprueba ahí sus propias reglas. Un test demuestra que
auth no se fía del backoffice: alguien que no es del staff y llama a `staff.grant`
recibe el 403 de auth.

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.test.ts
test('only the staff grant: auth checks it again', async () => {
  const ana = await t.signUp('Ana')
  await t.signUp('Bob')

  await expect(t.as(ana, () => t.modules.staff.grant({ email: 'bob@cooper.test' }))).rejects.toMatchObject({ status: 403 })
})
```

## Contar con Kysely, en boards

¿Cuántas cards tiene cada espacio de trabajo? `TableRepository` tiene `count(criteria)`,
pero eso es una consulta por espacio. Lo que quieres es una consulta que agrupe:
`SELECT workspace_id, COUNT(*) … GROUP BY workspace_id`. Los criterios no saben decir
"agrupa por".

El backoffice no puede lanzar esa consulta él mismo. La tabla `card` es de boards, y
solo el repositorio de cards de boards la toca. Así que boards ofrece el recuento como un
caso de uso, y su repositorio lo resuelve con **Kysely**, un *query builder* con tipos
que newt ejecuta sobre la conexión del store.

La base de boards recibe una instancia de Kysely con `kyselyFor`, tipada con las tablas
de boards:

```ts
// cooper/backend/contexts/boards/boards-base.ts
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

```ts
// cooper/backend/contexts/boards/boards-database.ts
export type BoardsDatabase = {
  board: SqliteRow<BoardRow>
  column: SqliteRow<ColumnRow>
  card: SqliteRow<CardRow>
}
```

El repositorio la usa:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * How many cards each of these workspaces has, by one query that groups them (ch.
 * 26). Across workspaces on purpose: for the staff's backoffice, which looks at
 * all of them, never for a workspace's own work.
 */
async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
  if (workspaceIds.length === 0) return []
  const rows = await this.base.db
    .selectFrom('card')
    .select(eb => ['workspaceId', eb.fn.countAll<number>().as('cards')])
    .where('workspaceId', 'in', workspaceIds)
    .groupBy('workspaceId')
    .execute()
  const counts = new Map(rows.map(row => [row.workspaceId, Number(row.cards)]))
  return workspaceIds.map(workspaceId => ({ workspaceId, cards: counts.get(workspaceId) ?? 0 }))
}

/** How many cards each board of the current workspace has: boards without any are not there. */
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

Y el módulo se los ofrece a otros contextos:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** For other contexts (the staff's backoffice): how many cards each of these workspaces has. */
@UseCase()
async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
  return this.repo.countByWorkspace([...new Set(workspaceIds)])
}

/** For other contexts: how many cards each board of a workspace has. */
@UseCase()
async countByBoard(workspaceId: string): Promise<CardCountByBoard[]> {
  return runInWorkspace(workspaceId, () => this.repo.countByBoard())
}
```

Lo que conviene saber de Kysely en newt:

- **Los campos se llaman como en la fila** (`workspaceId`), no como la columna
  (`workspace_id`): Kysely los traduce por el camino. Las tablas conservan su nombre
  (`card`).
- **Se ejecuta en la transacción en curso**, como todo lo que hace el repositorio. Las
  transacciones propias de Kysely están prohibidas: una transacción siempre es la del
  store. Una escritura con Kysely va dentro de `saveRows` (como hace
  `card.purgeWorkspace`).
- **Un recuento puede volver como texto** en Postgres (y una suma en Postgres y MySQL):
  pásalo por `Number(…)`, como hace el código de arriba, y valdrá en los tres.
- **Kysely no conoce el ámbito.** El `scope: { field: 'workspaceId', current }` del
  repositorio añade el espacio de trabajo a cada consulta por criterios, pero una
  consulta de Kysely es tuya: escribe tú el espacio, como hace `countByBoard` con
  `currentWorkspaceId()`. `countByWorkspace` lo deja fuera a propósito, y su
  comentario lo dice.

### La regla de la portabilidad

Cada paso por esta lista te ata un poco más a un store. Baja solo cuando el anterior no
llegue:

1. **`TableRepository` y criterios**, por defecto. Valen en todos los stores, también
   en ficheros.
2. **Kysely**, para lo que un criterio no sabe decir. Vale en todos los stores SQL:
   SQLite, Postgres, MySQL.
3. **El SQL propio de un store**, solo cuando no hay otro camino. Ponlo en un único
   sitio, y márcalo con un comentario que diga de qué store es y por qué.

boards se queda en el paso 2. En la siguiente sección verás un paso 3, marcado como pide
la regla.

## Métricas: una proyección por el puerto de analítica

El resumen del backoffice muestra las cards creadas por día, los espacios abiertos y
las altas. Podrías contarlas en auth y boards cada vez. Pero un recuento sobre todo
cooper, por días, es de las consultas que crecen con los datos, y se ejecutaría sobre
las bases de datos que atienden a los usuarios.

El backoffice guarda sus números aparte, como una **proyección**: una copia de los
datos, pensada para leerla. La verdad sigue en auth y boards, con sus transacciones.
Unos workers siguen sus eventos y añaden una fila por cada cosa que pasa.

newt define un puerto para esto, `Analytics`, con una sola forma de escribir: añadir.

```ts
// packages/newt/port-analytics/analytics.ts
export interface Analytics {
  /** Adds rows to a dataset; a row whose id is already there is left out. */
  append(dataset: string, rows: AnalyticsRow[]): Promise<void>
  close(): Promise<void>
}
```

- **Solo se añade.** Una fila, una vez dentro, ni cambia ni se va.
- **Cada fila lleva su `id`.** Una fila cuyo id ya está en su dataset no se añade otra
  vez, así que un worker que se ejecuta dos veces cuenta una.
- **Leer es cosa de cada adaptador**, en el lenguaje de su base de datos: las consultas
  analíticas no caben en unos criterios.

newt aún no trae adaptadores. cooper escribe uno pequeño sobre SQLite, en `shared/`, y
lo guarda en la base de datos del propio backoffice:

```ts
// cooper/backend/shared/analytics/sqlite-analytics.ts
export class SqliteAnalytics implements Analytics, AnalyticsCounts {

  constructor(private readonly store: SqliteStore) {}

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.store.transaction(() => {
      const insert = this.store.connection.query('INSERT OR IGNORE INTO analytics_row (dataset, id, data) VALUES (?, ?, ?)')
      for (const row of rows) insert.run(dataset, row.id, JSON.stringify(row))
    })
  }

  // …

  async countBy(dataset: string, field: string, options: { from?: string } = {}): Promise<AnalyticsCount[]> {
    if (!FIELD.test(field)) throw new Error(`'${field}' is not a field a row may have`)
    // SQLite only: `json_extract` reads a field of the JSON; DuckDB or ClickHouse would read a column.
    const found = this.store.connection.query(`
      SELECT json_extract(data, ?) AS value, COUNT(*) AS count
      FROM analytics_row
      WHERE dataset = ? AND json_extract(data, ?) >= ?
      GROUP BY value
      ORDER BY value
    `).all(`$.${field}`, dataset, `$.${field}`, options.from ?? '') as { value: unknown, count: number }[]
    return found.map(row => ({ value: String(row.value), count: row.count }))
  }
```

Ahí está el paso 3 de la regla de la portabilidad: SQL de un store, en un único sitio,
marcado. `INSERT OR IGNORE` con la clave primaria `(dataset, id)` cumple la promesa del
puerto de dejar fuera una fila repetida.

Leer no está en el puerto de newt, así que cooper declara las preguntas que hace en una
interfaz propia. El módulo de métricas recibe las dos, y nunca sabe qué adaptador
responde:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric-options.ts
export type Metric_Options = {
  /** Where they are kept: appended to by the workers, read by the overview. */
  analytics: Analytics & AnalyticsCounts
  /** How many days the overview goes back, today included. */
  days: number
}
```

Los workers se suscriben a eventos de auth y de boards, cada uno con un `handler`:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.workers.ts
/**
 * What the metrics count, each from an event of another context: a `handler`, a job
 * saved with what happened, in that context's outbox and run by its worker until it
 * succeeds. Not `fireAndForget`: a number lost when the server stops would be wrong
 * for good. Each one appends a row by the id of what it counts, so running it twice
 * counts once (ch. 28).
 */
export function registerMetricWorkers(metrics: Metric_Module, deps: Metric_Deps): void {
  deps.card.events.created.subscribe(card => metrics.recordCard(card), {
    strategy: 'handler',
    queue: 'metric.recordCard.on.card.created',
  })
  deps.tenant.events.created.subscribe(tenant => metrics.recordWorkspace(tenant), {
    strategy: 'handler',
    queue: 'metric.recordWorkspace.on.tenant.created',
  })
  deps.user.events.signedUp.subscribe(user => metrics.recordSignUp(user), {
    strategy: 'handler',
    queue: 'metric.recordSignUp.on.user.signedUp',
  })
}
```

Cada caso de uso añade una fila, con el id de lo que cuenta:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.module.ts
/** A card was made, in a board of a workspace. */
@UseCase()
async recordCard(card: CardDTO): Promise<void> {
  await this.options.analytics.append(METRIC_DATASETS.cardCreated, [{ id: card.id, workspaceId: card.workspaceId, day: dayOf(card.createdAt) }])
}
```

Fíjate en dónde viven estos jobs. Una suscripción a `card.created` se escribe en la
transacción que publica el evento, así que su job está en el outbox de **boards**, y lo
ejecuta el worker de boards. Los de `tenant.created` y `user.signedUp` están en el de
**auth**. El outbox del backoffice no tiene ninguno. Eso importa cuando los esperas en
un test ([capítulo 25](./25-tests)).

La tabla de analítica sale de una migración que guarda `shared/analytics` y que el
backoffice copia en su carpeta, como hace con la de la sesión web
([capítulo 24](./24-migrations)).

### Compruébalo

Los números van un momento por detrás. El test lo dice, y después espera a los workers:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.test.ts
test('counts what auth and boards tell, once their workers ran', async () => {
  const sam = await t.staffMember('Sam')
  const ana = await t.signUp('Ana')
  const acme = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
  await t.board(ana, acme.id, 'Roadmap', ['One', 'Two', 'Three'])

  // Nothing yet: the numbers are a projection, a moment behind.
  expect((await t.as(sam, () => t.modules.metric.overview())).totals).toEqual({ cards: 0, workspaces: 0, signUps: 0 })

  await t.settled()

  const { cards } = (await t.boards.modules.card.countByWorkspace([acme.id]))[0]!
  expect(cards).toBeGreaterThanOrEqual(3)
  const overview = await t.as(sam, () => t.modules.metric.overview())
  expect(overview.totals).toEqual({ cards, workspaces: 1, signUps: 2 })
  // …
})

test('counts a card once, however many times its worker runs', async () => {
  const card = { id: '0190a0a0-0000-7000-8000-000000000001', workspaceId: 'w', createdAt: new Date().toISOString() } as CardDTO
  await t.modules.metric.recordCard(card)
  await t.modules.metric.recordCard(card)

  const sam = await t.staffMember('Sam')
  expect((await t.as(sam, () => t.modules.metric.overview())).totals.cards).toBe(1)
})
```

`newt/port-analytics/contract` trae además `describeAnalyticsContract`, la batería que
todo adaptador debe pasar. `sqlite-analytics.test.ts` la ejecuta sobre el adaptador de
cooper.

## Ver qué hizo una petición: un tracer

Cada llamada a un caso de uso es un **span** de una traza, con su nombre
(`workspace.get`), su contexto y su módulo. Un caso de uso llamado desde otro es un span
dentro del suyo. Un reintento tras un conflicto queda anotado como un evento, y un error
que no es de negocio marca el span.

newt no registra nada si no le das a la base un `Tracer`. cooper tiene uno que escribe en
la consola, en `shared/observability`, y el backoffice lo usa cuando `COOPER_TRACE` vale
`1`:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.ts
static async open(config: Backoffice_Config, deps: Backoffice_ModuleDeps): Promise<Backoffice_Context> {
  const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
  const base = new CooperBase({ name: 'backoffice', store, tracer: config.trace ? new ConsoleTracer() : undefined })
  return new Backoffice_Context(base, initializeModules(base, config, deps), config)
}
```

El tracer implementa la interfaz de newt, la misma que implementaría un adaptador para
OpenTelemetry:

```ts
// cooper/backend/shared/observability/console-tracer.ts
export class ConsoleTracer implements Tracer {

  /** The span running now, which a span started inside it is a child of. */
  private readonly active = new AsyncLocalStorage<TracedSpan>()

  constructor(private readonly write: TraceWriter = line => console.log(line)) {}

  async startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    if (name.startsWith('job.')) return fn({ setError() {}, addEvent() {}, end() {} })

    const parent = this.active.getStore()
    const traced: TracedSpan = { name, attributes, started: performance.now(), ms: 0, error: null, events: [], children: [] }
    parent?.children.push(traced)
    // …
    try {
      return await this.active.run(traced, () => fn(span))
    } finally {
      if (traced.ms === 0) span.end()
      // A trace is written whole, once the span that began it ends.
      if (!parent) this.print(traced, 0)
    }
  }
  // …
}
```

El worker de jobs tiene sus propios spans, que empiezan por `job.` (`job.claim` se
ejecuta cada pocos segundos). Este tracer los deja fuera: lo que hace un job es un caso de
uso, y ese sí se escribe.

Su test enseña lo que obtienes:

```ts
// cooper/backend/shared/observability/console-tracer.test.ts
expect(lines.map(line => line.replace(/\d+\.\d ms/, 'n ms'))).toEqual([
  '[trace] backoffice workspace.get n ms',
  '[trace]   backoffice staff.enter n ms (conflict.retry {"attempt":1})',
  '[trace]   broken n ms (error: disk full)',
])
```

Para probarlo, arranca cooper con la variable y abre el backoffice:

```bash
COOPER_TRACE=1 bun run cooper
```

Cada contexto tiene su base, así que cada uno tiene su tracer, o ninguno. cooper solo le
da uno al backoffice. Cuando `workspace.get` llama a `tenant.get` de auth, esa llamada
pasa por las invocaciones de auth, que no registran nada: ves los casos de uso del
backoffice, no los de auth ni los de boards. Para trazarlos también, dale un tracer a sus
bases.

## En resumen

- Un acceso sin tenant (`tenantId: null`) es un acceso a todo un producto: el staff de
  cooper.
- Comprueba quién puede entrar en cada petición, con el middleware de un grupo. No lo
  guardes en la sesión: una retirada tiene que contar al momento.
- 401 es que no hay nadie con sesión; 403, alguien que no puede; 404, algo que no existe.
  Elige 404 en vez de 403 cuando un 403 revelaría que algo existe.
- Un contexto que lee de otros compone sus casos de uso: unas pocas llamadas por página,
  nunca una por fila. Ofrece las lecturas por lotes (`getMany`,
  `countByWorkspace(ids)`).
- Lo que un criterio no sabe decir va a Kysely, en el repositorio dueño de la tabla.
  Kysely no aplica el ámbito: escríbelo tú.
- `TableRepository` por defecto, Kysely para lo demás, y el SQL propio de un store solo
  cuando no hay otro camino, en un único sitio y marcado.
- Las métricas son una proyección: workers `handler` añaden filas con id, así que un job
  repetido cuenta una vez.
- Un tracer va en la base de un contexto. Sin él, no se registra nada.
