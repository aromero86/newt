# Jobs muertos y analítica

El backoffice puede mostrar cada workspace y cada cuenta. Faltan dos cosas para que el
personal cuide de cooper.

**Jobs que murieron.** El job de un `handler` se ejecuta de nuevo hasta que tiene éxito, o
hasta agotar sus intentos. Uno que falla siempre se marca como muerto, con su último
error, y espera ([capítulo 12](./12-failures)). Primero hay que arreglar algo (un servidor
de correo, un bug), y luego alguien debe volver a ponerlo en marcha. Cada contexto guarda
sus jobs en su propio store, y desde el capítulo 12 cada uno tiene un módulo `outbox` con
dos casos de uso para ellos, `dead` y `retry`, y sin rutas: esperaban al personal.

**Cifras.** Cuántas tarjetas se crearon cada día, cuántos workspaces se abrieron, cuánta
gente se registró. Podrías contarlas en auth y boards cada vez. Pero un conteo de todo
cooper, por día, es el tipo de consulta que crece con los datos, y se ejecutaría en las
bases de datos que atienden a la gente que usa cooper.

Este capítulo añade los dos últimos módulos del backoffice:

- **`job`**: los jobs muertos de cada contexto, listados y reintentados, cada uno por los
  casos de uso del outbox de ese contexto.
- **`metric`**: las cifras de cooper, una proyección alimentada por workers de los eventos
  de auth y de boards y guardada con el **puerto de analítica** de newt, `Analytics`, que
  solo añade. Su adaptador es el propio de cooper, `SqlAnalytics`, sobre Kysely. newt trae
  el contrato del puerto, `describeAnalyticsContract`, que el adaptador pasa, y
  `MemoryAnalytics`, un adaptador en memoria para tests.

Con la API completa, el backoffice recibe su frontend, copiado del repositorio, y el seed
crea su primera cuenta del personal.

## Jobs muertos, de todos los contextos

### El puerto del outbox, visto desde fuera

Un store guarda sus jobs en su **outbox**, el puerto `Outbox` de newt, de
`newt/port-outbox`, en `base.store.outbox`. Su worker usa casi todo (`claim`, `close`,
`renew`). Tres de sus métodos son para quien cuida de los jobs:

```ts
// packages/newt/port-outbox/outbox.ts
  /**
   * Puts a dead job back to wait, as new: no attempts, due now. For whoever fixed
   * what killed it. Whether it was dead and is now waiting: a job in any other state,
   * or none with that id, is left as it is.
   */
  retry(id: string): Promise<boolean>
// …
  /**
   * The jobs it keeps, oldest first (by `createdAt`, then `id`), all of them or those
   * `query` says: for whoever looks after them (an admin page, a test).
   */
  list(query?: JobQuery): Promise<Job[]>
  /** One job, by its id; none if it is not kept. */
  get(id: string): Promise<Job | undefined>
```

- **`list({ status: 'dead' })`** lee los muertos. Un `JobQuery` también acepta `after` y
  `limit` para leer página a página.
- **`retry(id)`** devuelve un job muerto a la espera, con todos sus intentos, para ahora
  mismo. Responde `false` para un job que no está muerto: uno pendiente o en ejecución va
  de camino, uno terminado está terminado, y ejecutarlo otra vez lo haría dos veces.
- **`get(id)`** lee uno, para decir por qué un reintento no hizo nada.

El `Outbox_Module` de cooper ([capítulo 12](./12-failures)) son estos tres, como casos de
uso: `dead(page)` lista con `list`, los más nuevos primero, y `retry(id)` llama a `retry`
y, cuando responde `false`, pregunta a `get` si el job no existe (`outbox.job_not_found`,
un 404) o no está muerto (`outbox.job_not_dead`, un 409).

El backoffice no puede leer el outbox de auth por sí mismo: sería meter la mano en el store
de otro contexto, algo que ni siquiera permite un `Pick` de los módulos de auth. Así que se
le da el **módulo** `outbox` de cada contexto, como se le dieron `tenant` y `card` en el
[capítulo 25](./25-backoffice).

### Qué contextos

El módulo `job` nombra los contextos cuyos jobs cuida el personal. Crea
`modules/job/job.schema.ts` en el backoffice:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.schema.ts
import { z } from 'zod'
import type { DeadJobDTO } from '../../../../shared/outbox/outbox.schema'

/** The contexts whose jobs the staff look after: each one runs its own. */
export const JOB_CONTEXTS = ['auth', 'boards', 'backoffice'] as const

export const JobContextSchema = z.enum(JOB_CONTEXTS)

export type JobContext = z.infer<typeof JobContextSchema>

/** A dead job of a context, as the staff's page lists it. */
export type ContextJobDTO = DeadJobDTO & { context: JobContext }
```

`JOB_CONTEXTS` es una lista de nombres, y `JobContextSchema` rechaza cualquier otro: una
ruta que toma el contexto de su ruta no puede recibir `nowhere`. Un job muerto, como lo
lista la página, es el `DeadJobDTO` del capítulo 12, con su contexto.

### Qué recibe

```ts
// cooper/backend/contexts/backoffice/modules/job/job.deps.ts
import type { Outbox_Module } from '../../../../shared/outbox/outbox.module'
import type { Staff_Module } from '../staff/staff.module'
import type { JobContext } from './job.schema'

export interface Job_Deps {
  /** That who asks is of the staff, before any route answers. */
  staff: Staff_Module
  /** Each context's jobs, through the use cases it offers for them: auth's, boards' and the backoffice's own. */
  outboxes: Record<JobContext, Outbox_Module>
}
```

`outboxes` es un record por contexto: un `Outbox_Module` para cada uno de auth, boards y el
propio backoffice.

### Las rutas

```ts
// cooper/backend/contexts/backoffice/modules/job/job.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Job_Deps } from './job.deps'
import type { Job_Module } from './job.module'
import type { JobContext } from './job.schema'

export function registerJobRoutes(base: CooperBase, jobs: Job_Module, deps: Job_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `/jobs/boards`: boards' dead jobs. A context that is not one is a 400.
  routes.get('/jobs/:context', async request =>
    Response.json(await jobs.dead(request.params.context as JobContext, pageRequestFrom(request))))

  routes.post('/jobs/:context/:jobId/retry', async request => {
    await jobs.retry(request.params.context as JobContext, request.params.jobId)
    return new Response(null, { status: 204 })
  })
}
```

El contexto llega en la ruta como un string; el cast solo dice a TypeScript lo que comprueba
el caso de uso. Un contexto que no lo es falla en `JobContextSchema.parse`, que el router
responde como un 400, como cualquier entrada inválida.

### El módulo

```ts
// cooper/backend/contexts/backoffice/modules/job/job.module.ts
import { Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { Job_Deps } from './job.deps'
import { registerJobRoutes } from './job.routes'
import { JobContextSchema, type ContextJobDTO, type JobContext } from './job.schema'

/**
 * The jobs that died in each context of cooper: a reaction that failed
 * every attempt waits, with its last error, for someone to look. The staff see them
 * here and, once what killed one is fixed, put it back to run. Each context keeps
 * and runs its own jobs: this module only asks each one, through its use cases.
 */
export class Job_Module extends Module {

  static initialize(base: CooperBase, deps: Job_Deps): Job_Module {
    const module = new Job_Module(base, deps)
    registerJobRoutes(base, module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: Job_Deps) {
    super('job', base.invocations, deps)
  }

  /** A page of a context's dead jobs, the newest first. */
  @UseCase()
  async dead(context: JobContext, page: PageRequest): Promise<Page<ContextJobDTO>> {
    const name = JobContextSchema.parse(context)
    const found = await this.deps.outboxes[name].dead(page)
    return { ...found, items: found.items.map(job => ({ ...job, context: name })) }
  }

  /**
   * A dead job of a context runs again: what a person of the staff asks for, at once,
   * once they fixed what killed it. The context's own use case puts it back; its
   * worker runs it. No `writesTo`, not even for the backoffice's own outbox: the
   * write rule watches what repositories save, and a job put back is the store's
   * outbox, written by `outbox.retry` in one step.
   */
  @UseCase()
  async retry(context: JobContext, id: string): Promise<void> {
    await this.deps.outboxes[JobContextSchema.parse(context)].retry(id)
  }
}
```

No guarda nada y no ejecuta nada. `dead` pide una página al módulo outbox del contexto y
marca cada job con su contexto; `retry` le pide que devuelva uno a la espera. El worker del
propio contexto lo ejecuta, como ejecuta cada job de su store.

¿Por qué no `writesTo`? Reintentar un job de auth o de boards llama al caso de uso de otro
contexto: esa es la raíz de lo que ocurre allí ([capítulo 25](./25-backoffice)), y la regla
de escritura no tiene nada que decir aquí. Reintentar un job del propio backoffice llama a
`outbox.retry` en el mismo contexto, y aun así no escribe filas de ningún módulo: la regla
comprueba lo que guardan los repositorios, y `outbox.retry` no guarda nada por uno. Es una
sola escritura en el outbox del store, la tabla en la que murió el job, así que un fallo no
deja nada a medias, y no hay nada que declarar en `writesTo`.

El outbox del propio backoffice todavía no tiene ningún job: ninguno de sus módulos reacciona
a los eventos del propio backoffice. Está en la lista para que el día que alguno lo haga,
sus jobs muertos aparezcan en la misma página.

## Analítica: un puerto que solo añade

Las cifras son una **proyección**: una copia de los datos, hecha para leer. La verdad se
queda en auth y boards, con sus transacciones. Los workers siguen sus eventos y añaden una
fila por cada cosa que ocurrió. La copia va un momento por detrás, y nunca estorba a lo que
cuenta.

newt define un puerto para esos datos, `Analytics`, en `newt/port-analytics`:

```ts
// packages/newt/port-analytics/analytics.ts
/**
 * Where analytical data goes: a database made for reading a lot at once (ClickHouse,
 * DuckDB), not for saving entities. It is only ever added to: a row, once in, never
 * changes or goes; what changes later is a new row telling it.
 *
 * It has no transactions, so it is never a context's store: it is fed by `handler`
 * workers, after the events of what the store saved. A worker may run twice, so a row
 * carries an id of its own (the event's, the order line's): one already in is not
 * added again.
 *
 * Reading is each adapter's own: analytical queries are its database's language.
 */
export interface Analytics {
  /** Adds rows to a dataset; a row whose id is already there is left out. */
  append(dataset: string, rows: AnalyticsRow[]): Promise<void>
  close(): Promise<void>
}
```

Una fila es cualquier cosa con un id:

```ts
// packages/newt/port-analytics/analytics-row.ts
/** A row of an analytical dataset: anything, with an id that makes it unique. */
export type AnalyticsRow = { id: string, [field: string]: unknown }
```

Lo que promete el puerto:

- **Las filas solo se añaden.** Una fila, una vez dentro, nunca cambia ni se va. Lo que
  cambia después es una fila nueva que lo dice.
- **Toda fila tiene un id**, y una fila cuyo id ya está en su dataset se deja fuera. Un
  worker que se ejecuta dos veces cuenta una.
- **Sin transacciones**, así que nunca es el store de un contexto. Lo alimentan workers
  `handler`, después del guardado cuyo evento siguen.
- **Leer es cosa de cada adaptador.** Las consultas analíticas (agrupar por día, por mes, el
  top diez) están en el lenguaje propio de la base de datos, así que el puerto no intenta
  decirlas.

newt todavía no trae ningún adaptador para una base de datos analítica real. Trae
`MemoryAnalytics`, para tests, y la suite que comprueba un adaptador,
`describeAnalyticsContract`, ambos en `newt/port-analytics/contract`.

### Las preguntas de cooper

Leer no está en el puerto, así que cooper declara las preguntas que hace en una interfaz
propia. El módulo que lee recibe esto, y no sabe qué adaptador responde. Crea
`shared/analytics/analytics-counts.ts`:

```ts
// cooper/backend/shared/analytics/analytics-counts.ts
/** How many rows of a dataset have one value of a field. */
export type AnalyticsCount = { value: string, count: number }

/**
 * The questions cooper asks its analytics. newt's port only appends: reading is each
 * adapter's own, in its database's language. A module that reads them takes this, so
 * it does not know which adapter answers.
 */
export interface AnalyticsCounts {
  /** How many rows a dataset has. */
  count(dataset: string): Promise<number>
  /**
   * How many rows of a dataset have each value of a field, in the order of the values,
   * from one on (`from`, compared as text: a day such as `2026-10-01`, a month).
   */
  countBy(dataset: string, field: string, options?: { from?: string }): Promise<AnalyticsCount[]>
}
```

Dos preguntas bastan para un resumen: cuántas filas tiene un dataset, y cuántas tienen cada
valor de un campo, a partir de un valor (`countBy('card_created', 'day', { from:
'2026-10-01' })`: las tarjetas de cada día desde el 1 de octubre).

### Su tabla

cooper guarda su analítica en la base de datos SQL propia del contexto, para una aplicación
cuyas cifras son lo bastante pequeñas para ello. Una tabla guarda todos los datasets, cada
fila entera como JSON. La migración vive con el adaptador, en `shared/analytics`, y un
contexto que guarda analítica la copia, como con la de la sesión web:

```sql
-- cooper/backend/shared/analytics/migrations/sqlite/00001_analytics_up.sql
-- Analytics in the context's own database (shared/analytics): every dataset's rows
-- in one table, each one whole as JSON. A context that keeps its analytics there
-- copies this migration into its own, numbered after the ones it has. Rows are only
-- ever added: one whose id is already in its dataset is left out (`ON CONFLICT DO NOTHING`).
CREATE TABLE analytics_row (
  dataset TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);
```

```sql
-- cooper/backend/shared/analytics/migrations/sqlite/00001_analytics_down.sql
DROP TABLE analytics_row;
```

La clave primaria `(dataset, id)` es la promesa del puerto escrita en el esquema: una fila
cuyo id ya está dentro no se puede añadir dos veces.

### `SqlAnalytics`, sobre Kysely

El adaptador implementa el puerto de newt y las preguntas de cooper. Sus consultas son de
Kysely, ejecutadas en la conexión del store con `kyselyFor`, como los conteos de boards en
el [capítulo 15](./15-kysely). Crea `shared/analytics/sql-analytics.ts`:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
import { sql, type RawBuilder } from 'kysely'
import type { SqliteStore } from 'newt/adapter-sqlite'
import { kyselyFor } from 'newt/kysely'
import type { Analytics, AnalyticsRow } from 'newt/port-analytics'
import type { AnalyticsCount, AnalyticsCounts } from './analytics-counts'

/** A field of a row, as a query names it: letters, digits and `_`, never a piece of SQL. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Its one table, as Kysely queries it: each row whole, as JSON text. */
type AnalyticsDatabase = {
  analytics_row: { dataset: string, id: string, data: string }
}

/**
 * newt's analytics port on the context's own SQL database, SQLite, for an
 * application whose numbers are small enough for it: newt brings no adapter yet
 * (ClickHouse and DuckDB will come). Every dataset is in one table, `analytics_row`,
 * each row whole as JSON, in the database of the context that reads it: it copies
 * `migrations/sqlite/00001_analytics_up.sql` into its own. Its queries are Kysely's.
 *
 * It keeps the port's promises (`describeAnalyticsContract`): rows are only added, and
 * one whose id is in already is left out, so the worker that appends may run twice.
 * Each append is a transaction of its own, as a mailer's send is a call of its own: it
 * is fed by `handler` workers, never inside the save of an entity.
 */
export class SqlAnalytics implements Analytics, AnalyticsCounts {

  private readonly db

  constructor(private readonly store: SqliteStore) {
    this.db = kyselyFor<AnalyticsDatabase>(store)
  }

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.store.transaction(async () => {
      await this.db.insertInto('analytics_row')
        .values(rows.map(row => ({ dataset, id: row.id, data: JSON.stringify(row) })))
        .onConflict(conflict => conflict.columns(['dataset', 'id']).doNothing())
        .execute()
    })
  }

  /** A dataset's rows, by id. */
  async rows(dataset: string): Promise<AnalyticsRow[]> {
    const found = await this.db.selectFrom('analytics_row').select('data').where('dataset', '=', dataset).orderBy('id').execute()
    return found.map(row => JSON.parse(row.data) as AnalyticsRow)
  }

  async count(dataset: string): Promise<number> {
    const found = await this.db.selectFrom('analytics_row').select(eb => eb.fn.countAll<number>().as('count')).where('dataset', '=', dataset).executeTakeFirstOrThrow()
    return Number(found.count)
  }

  async countBy(dataset: string, field: string, options: { from?: string } = {}): Promise<AnalyticsCount[]> {
    if (!FIELD.test(field)) throw new Error(`'${field}' is not a field a row may have`)
    const value = this.fieldOf(field)
    const found = await this.db.selectFrom('analytics_row')
      .select(eb => [value.as('value'), eb.fn.countAll<number>().as('count')])
      .where('dataset', '=', dataset)
      .where(value, '>=', options.from ?? '')
      .groupBy(value)
      .orderBy(value)
      .execute()
    return found.map(row => ({ value: String(row.value), count: Number(row.count) }))
  }

  /** The store is the context's, which closes it: there is nothing of its own to close. */
  async close(): Promise<void> {}

  /**
   * A field of the JSON, as text: each database says it its own way (DuckDB or
   * ClickHouse would read a column). It is a name, checked above, never a piece of SQL.
   */
  private fieldOf(field: string): RawBuilder<string> {
    return sql<string>`json_extract(data, ${sql.lit(`$.${field}`)})`
  }
}
```

- **`append`** inserta las filas con `ON CONFLICT (dataset, id) DO NOTHING`: una fila cuyo
  id ya está dentro, o dos veces en el mismo `append`, se deja fuera. Se ejecuta en una
  transacción propia (`store.transaction`), como el envío de un mailer es una llamada
  propia: los workers que lo alimentan nunca están dentro del guardado de una entidad.
- **`rows`** vuelve a leer un dataset, por id: lo que necesita la suite del contrato para
  comprobarlo.
- **`count`** y **`countBy`** son las preguntas de cooper. `countBy` agrupa por un campo del
  JSON, leído con `json_extract`. Esa es la forma de decirlo de SQLite, así que está en un
  solo sitio, `fieldOf`, que lo dice; el [capítulo 27](./27-postgres) da a Postgres la
  suya. El nombre de un campo entra en el SQL como un literal, así que debe ser un nombre y
  nada más: `FIELD` rechaza todo lo que no sean letras, dígitos y `_` antes de construir
  ninguna consulta.
- **`close`** no tiene nada que hacer: el store es del contexto, y el contexto lo cierra.

Por ahora recibe un `SqliteStore`. El capítulo 27 lo abre a cualquier store SQL.

### El contrato

Un adaptador cumple las promesas del puerto o no es un adaptador. newt las escribe como una
suite, `describeAnalyticsContract`, como hace con los stores (`describeStoreContract`) y
como hiciste tú para la búsqueda de tarjetas en el [capítulo 16](./16-search-port). Recibe
un nombre y un fixture: cómo abrir una analítica nueva y vacía, y cómo volver a leer un
dataset, ya que el propio puerto no puede leer. Sus tests comprueban que las filas se
guardan cada una en su dataset, que una fila cuyo id ya está dentro nunca se añade, que la
primera fila de un id se queda sin cambios, y que un id repetido en un `append` se guarda
una vez.

`MemoryAnalytics` pasa la misma suite en los tests propios de newt. Guarda cada dataset en
un mapa por id, y tiene un `rows(dataset)` propio para el fixture. El test de un módulo que
necesita analítica, y no una base de datos, puede darle uno.

Ejecuta la suite sobre `SqlAnalytics`, con un store propio en memoria que solo tiene la
tabla de analítica, y añade un test de las preguntas de cooper:

```ts
// cooper/backend/shared/analytics/sql-analytics.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { describeAnalyticsContract } from 'newt/port-analytics/contract'
import { SqlAnalytics } from './sql-analytics'

/** A store of its own, in memory, with the analytics table and nothing else. */
const openStore = () => SqliteStore.open({ path: ':memory:', migrations: join(import.meta.dir, 'migrations/sqlite') })

const stores: SqliteStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()))
})

async function open(): Promise<SqlAnalytics> {
  const store = await openStore()
  stores.push(store)
  return new SqlAnalytics(store)
}

describeAnalyticsContract('SqlAnalytics', {
  open,
  rows: (analytics, dataset) => analytics.rows(dataset),
})

describe('SqlAnalytics', () => {
  test('counts a dataset, and its rows by the value of a field, from one on', async () => {
    const analytics = await open()
    await analytics.append('card_created', [
      { id: 'c1', day: '2026-10-01' },
      { id: 'c2', day: '2026-10-03' },
      { id: 'c3', day: '2026-10-03' },
      { id: 'c4', day: '2026-09-30' },
    ])
    await analytics.append('workspace_created', [{ id: 'w1', day: '2026-10-03' }])

    expect(await analytics.count('card_created')).toBe(4)
    expect(await analytics.countBy('card_created', 'day', { from: '2026-10-01' })).toEqual([
      { value: '2026-10-01', count: 1 },
      { value: '2026-10-03', count: 2 },
    ])
    expect(await analytics.countBy('nothing', 'day')).toEqual([])
  })

  test('never takes a field that is not a name', async () => {
    const analytics = await open()
    await expect(analytics.countBy('card_created', 'day\') OR 1=1 --')).rejects.toThrow('is not a field')
  })
})
```

El último test es la guarda de `FIELD`: un campo que intenta ser SQL se rechaza antes de
llegar a la base de datos.

## El módulo metric

### Qué cuenta

Tres datasets, una fila por cada cosa que ocurrió, por su id. Y el resumen que ve el
personal: totales, y cada uno de los últimos días. Crea `modules/metric/metric.schema.ts`:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.schema.ts
/** How many things happened on one day (`2026-10-26`, UTC). */
export type DayCountDTO = { day: string, count: number }

/** cooper's numbers, as the staff's overview shows them: from the analytics, a moment behind. */
export type MetricsOverviewDTO = {
  /** Every one there has ever been. */
  totals: {
    cards: number
    workspaces: number
    signUps: number
  }
  /** The last days, today last, one entry for each day, those with none too. */
  cardsPerDay: DayCountDTO[]
  workspacesPerDay: DayCountDTO[]
  signUpsPerDay: DayCountDTO[]
}

/** The datasets of the analytics the backoffice feeds, one row for each thing that happened, by its id. */
export const METRIC_DATASETS = {
  cardCreated: 'card_created',
  workspaceCreated: 'workspace_created',
  userSignedUp: 'user_signed_up',
} as const
```

### Qué recibe

Sus opciones son dónde se guardan las cifras, y cuántos días muestra el resumen. La
analítica se tipa como el puerto y como las preguntas de cooper: los workers añaden, el
resumen lee:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric-options.ts
import type { Analytics } from 'newt/port-analytics'
import type { AnalyticsCounts } from '../../../../shared/analytics/analytics-counts'

/** What the context configures the metrics with. */
export type Metric_Options = {
  /** Where they are kept: appended to by the workers, read by the overview. */
  analytics: Analytics & AnalyticsCounts
  /** How many days the overview goes back, today included. */
  days: number
}
```

Sus deps son los módulos cuyos eventos cuenta, en auth y boards, y el personal para las
rutas:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.deps.ts
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module } from '../../../auth/modules/user/user.module'
import type { Card_Module } from '../../../boards/modules/card/card.module'
import type { Staff_Module } from '../staff/staff.module'

/** The modules whose events the metrics count, in auth and boards; and the staff, for the routes. */
export interface Metric_Deps {
  staff: Staff_Module
  auth: {
    /** `tenant.created`: a new workspace. */
    tenant: Tenant_Module
    /** `user.signedUp`. */
    user: User_Module
  }
  boards: {
    /** `card.created`. */
    card: Card_Module
  }
}
```

### Los workers

Cada cifra sigue un evento de otro contexto:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.workers.ts
import type { Metric_Deps } from './metric.deps'
import type { Metric_Module } from './metric.module'

/**
 * What the metrics count, each from an event of another context: a `handler`, a job
 * saved with what happened, in that context's outbox and run by its worker until it
 * succeeds. Not `fire-and-forget`: a number lost when the server stops would be wrong
 * for good. Each one appends a row by the id of what it counts, so running it twice
 * counts once.
 */
export function registerMetricWorkers(metrics: Metric_Module, deps: Metric_Deps): void {
  deps.boards.card.events.created.subscribe(card => metrics.recordCard(card), {
    strategy: 'handler',
    queue: 'metric.recordCard.on.card.created',
  })
  deps.auth.tenant.events.created.subscribe(tenant => metrics.recordWorkspace(tenant), {
    strategy: 'handler',
    queue: 'metric.recordWorkspace.on.tenant.created',
  })
  deps.auth.user.events.signedUp.subscribe(user => metrics.recordSignUp(user), {
    strategy: 'handler',
    queue: 'metric.recordSignUp.on.user.signedUp',
  })
}
```

Cada uno es un `handler`, no `fire-and-forget`. Un job se guarda con lo que ocurrió, en la
misma transacción, y se ejecuta hasta que tiene éxito. Una cifra perdida al detenerse el
servidor sería errónea para siempre, y nada la arreglaría nunca.

Fíjate en dónde viven estos jobs. El job de una suscripción se escribe en el store del
guardado que cuenta el evento ([capítulo 13](./13-another-context)). `card.created` se
cuenta en el store de boards, así que el job de `metric.recordCard.on.card.created` está en
el outbox **de boards**, ejecutado por el worker de boards. Los jobs de `tenant.created` y
`user.signedUp` están en el **de auth**. El outbox del propio backoffice no tiene ninguno.
Así que un job de métricas que muere aparece en la página de jobs muertos de boards o de
auth, y un test espera a los workers de auth y de boards para ver las cifras.

Los nombres de las colas siguen la regla del [capítulo 11](./11-reacting), `<módulo que
reacciona>.<caso de uso al que llama>.on.<módulo que cuenta>.<evento>`, y `newt/queue-name`
los comprueba.

### El módulo

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.module.ts
import { Module, now, UseCase } from 'newt/core'
import type { TenantDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import type { CardDTO } from '../../../boards/modules/card/card.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { Metric_Deps } from './metric.deps'
import type { Metric_Options } from './metric-options'
import { registerMetricRoutes } from './metric.routes'
import { METRIC_DATASETS, type DayCountDTO, type MetricsOverviewDTO } from './metric.schema'
import { registerMetricWorkers } from './metric.workers'

const DAY_MS = 24 * 60 * 60_000

/** The day of a moment, in UTC: `2026-10-26`. */
const dayOf = (iso: string) => iso.slice(0, 10)

/**
 * cooper's numbers: cards made, workspaces opened, people signed up. They are a
 * projection: the truth lives in auth and boards, with their transactions;
 * workers follow their events and append a row for each to the analytics, which
 * this module reads back added up. It is a moment behind, and never in the way of
 * what it counts.
 */
export class Metric_Module extends Module {

  static initialize(base: CooperBase, deps: Metric_Deps, options: Metric_Options): Metric_Module {
    const module = new Metric_Module(base, deps, options)
    registerMetricRoutes(base, module, deps)
    registerMetricWorkers(module, deps)
    return module
  }

  private constructor(base: CooperBase, deps: Metric_Deps, private readonly options: Metric_Options) {
    super('metric', base.invocations, deps)
  }

  /** A card was made, in a board of a workspace. */
  @UseCase()
  async recordCard(card: CardDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.cardCreated, [{ id: card.id, workspaceId: card.workspaceId, day: dayOf(card.createdAt) }])
  }

  /** A workspace was made. */
  @UseCase()
  async recordWorkspace(tenant: TenantDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.workspaceCreated, [{ id: tenant.id, day: dayOf(tenant.createdAt) }])
  }

  /** Someone made an account. */
  @UseCase()
  async recordSignUp(user: UserDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.userSignedUp, [{ id: user.id, day: dayOf(user.createdAt) }])
  }

  /** The totals, and each of the last days, today included. */
  @UseCase()
  async overview(): Promise<MetricsOverviewDTO> {
    const days = this.lastDays()
    const { analytics } = this.options
    const [cards, workspaces, signUps, cardsPerDay, workspacesPerDay, signUpsPerDay] = await Promise.all([
      analytics.count(METRIC_DATASETS.cardCreated),
      analytics.count(METRIC_DATASETS.workspaceCreated),
      analytics.count(METRIC_DATASETS.userSignedUp),
      this.perDay(METRIC_DATASETS.cardCreated, days),
      this.perDay(METRIC_DATASETS.workspaceCreated, days),
      this.perDay(METRIC_DATASETS.userSignedUp, days),
    ])
    return { totals: { cards, workspaces, signUps }, cardsPerDay, workspacesPerDay, signUpsPerDay }
  }

  /** How many rows of a dataset each day has, a day with none too. */
  private async perDay(dataset: string, days: string[]): Promise<DayCountDTO[]> {
    const counts = new Map((await this.options.analytics.countBy(dataset, 'day', { from: days[0] })).map(each => [each.value, each.count]))
    return days.map(day => ({ day, count: counts.get(day) ?? 0 }))
  }

  /** The days the overview shows, the oldest first and today last. */
  private lastDays(): string[] {
    const today = now().getTime()
    return Array.from({ length: this.options.days }, (_, index) => dayOf(new Date(today - (this.options.days - 1 - index) * DAY_MS).toISOString()))
  }
}
```

- **Su constructor recibe `deps` solo para pasárselas a `super`**: el módulo no guarda
  ninguna, las usan sus rutas y sus workers, como las de board
  ([capítulo 4](./04-who-and-where)).
- **`recordCard`, `recordWorkspace`, `recordSignUp`** añaden una fila cada uno, cuyo id es
  el id de lo que cuenta. Un worker que se ejecuta dos veces añade el mismo id dos veces, y
  el segundo se deja fuera. La fila guarda el día en que ocurrió, del `createdAt` de la
  propia entidad, en UTC: un job ejecutado tarde cuenta igualmente en el día correcto.
- **`overview`** pide los tres totales y las tres series a la vez, seis consultas en
  paralelo.
- **`perDay`** rellena los días sin filas: `countBy` solo responde los días que tienen
  filas, y un gráfico quiere todos los días.
- **`lastDays`** dice la hora con **`now()`** de `newt/core`, el reloj del contexto
  ([capítulo 19](./19-invitations-and-time)), no con `Date.now()`: un test que mueve el
  reloj ve moverse los días.

Estos casos de uso los llaman workers y no escriben ningún repositorio, así que la regla de
escritura no tiene nada que comprobar: un `append` no es el guardado de una entidad.

### La ruta

Una ruta, detrás de la misma comprobación que todas las demás:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.routes.ts
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Metric_Deps } from './metric.deps'
import type { Metric_Module } from './metric.module'

export function registerMetricRoutes(base: CooperBase, metrics: Metric_Module, deps: Metric_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  routes.get('/metrics', async () => Response.json(await metrics.overview()))
}
```

## Conectar

### La tabla de analítica en la base de datos del backoffice

El backoffice guarda su analítica en su propia base de datos. Copia la migración en su
carpeta, numerada después de la de la sesión:

```sql
-- cooper/backend/contexts/backoffice/migrations/sqlite/00002_analytics_up.sql
-- Analytics in the context's own database (shared/analytics): every dataset's rows
-- in one table, each one whole as JSON. A context that keeps its analytics there
-- copies this migration into its own, numbered after the ones it has. Rows are only
-- ever added: one whose id is already in its dataset is left out (`ON CONFLICT DO NOTHING`).
CREATE TABLE analytics_row (
  dataset TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);
```

```sql
-- cooper/backend/contexts/backoffice/migrations/sqlite/00002_analytics_down.sql
DROP TABLE analytics_row;
```

Su base de datos ahora guarda más que sesiones. En `backoffice.context.ts`, el comentario lo
dice:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.ts
// …
/**
 * The staff's console: it reads `auth` and `boards`, and changes them only through
 * their use cases. Only the staff (access to the `backoffice` app in `auth`) enter it.
 * Its own database keeps its web sessions and its analytics.
 */
// …
```

### Los módulos

`initialize-modules.ts` gana los outboxes en sus deps, y tres módulos: `metric`, el
`outbox` propio del backoffice, y `job`. El archivo entero:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
import { SqlAnalytics } from '../../shared/analytics/sql-analytics'
import type { CooperBase } from '../../shared/cooper-base'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { PRODUCTS, WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
import type { Boards_Modules } from '../boards/initialize-modules'
import type { Backoffice_Config } from './backoffice-config'
import { Job_Module } from './modules/job/job.module'
import { Metric_Module } from './modules/metric/metric.module'
import { Staff_Module } from './modules/staff/staff.module'
import { User_Module } from './modules/user/user.module'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * What `backoffice`'s modules are given besides its base: the use cases of the
 * contexts it reads, those it needs and nothing else. Never a context's base nor its
 * store: another context is reached through its use cases and its events.
 */
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
  boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
}

/** How many days the metrics' overview goes back, today included. */
const METRIC_DAYS = 30

/**
 * Every module of `backoffice`, each one after the modules it uses. They read auth and
 * boards through their modules' use cases, and keep only their sessions and their
 * analytics, in the context's own database.
 */
export function initializeModules(base: CooperBase, config: Backoffice_Config, deps: Backoffice_ModuleDeps) {
  const { auth, boards } = deps

  const staff = Staff_Module.initialize(base, { auth: { user: auth.user, access: auth.access } }, { productId: PRODUCTS.backoffice })
  const session = WebSession_Module.initialize(base, {
    context: 'backoffice',
    clientId: PRODUCTS.backoffice,
    clientSecret: config.clientSecret,
    publicUrl: config.publicUrl,
    authUrl: config.authPublicUrl,
    days: config.sessionDays,
    identify: accessToken => auth.token.verify(accessToken),
    // `{ user }`, as every web app reads its session; only for the staff: anyone else,
    // an access taken away since signing in, gets a 403.
    profile: async () => ({ user: await staff.me() }),
  })
  const user = User_Module.initialize(base, { staff, auth: { user: auth.user, access: auth.access, tenant: auth.tenant } }, { workspacesProduct: WORKSPACES_PRODUCT })
  const workspace = Workspace_Module.initialize(base, { staff, auth: { tenant: auth.tenant, access: auth.access, user: auth.user }, boards: { board: boards.board, card: boards.card } })
  const metric = Metric_Module.initialize(base, { staff, auth: { tenant: auth.tenant, user: auth.user }, boards: { card: boards.card } }, {
    analytics: new SqlAnalytics(base.store),
    days: METRIC_DAYS,
  })
  const outbox = Outbox_Module.initialize(base)
  // Each context's dead jobs, through its own use cases.
  const job = Job_Module.initialize(base, { staff, outboxes: { auth: auth.outbox, boards: boards.outbox, backoffice: outbox } })
  return { session, staff, user, workspace, metric, outbox, job }
}

export type Backoffice_Modules = ReturnType<typeof initializeModules>
```

- `Backoffice_ModuleDeps` elige `outbox` de los módulos de auth y de los de boards. Ambos lo
  tienen desde el capítulo 12 y el capítulo 17. `openContexts` ya pasa sus módulos enteros,
  así que no cambia.
- `metric` recibe su analítica: `SqlAnalytics` sobre el store propio del backoffice
  (`base.store`), y 30 días.
- `outbox` es el `Outbox_Module` propio del backoffice, sobre su store, inicializado como lo
  inicializan auth y boards.
- `job` recibe los tres outboxes, por nombre de contexto. Las claves del record se comprueban
  contra `JobContext`: un contexto añadido a `JOB_CONTEXTS` sin su outbox aquí no compila.

## Tests

### Esperar a las métricas

`settled` en `open-test-backoffice.ts` ya espera a los jobs de auth y luego a los de boards.
Ahí es exactamente donde están los jobs de las métricas. Su comentario lo dice ahora:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
// …
    /**
     * Until the background work is done, in the order it flows: auth's events (heard
     * by boards and by the metrics), then boards' (the cards the metrics count).
     */
// …
```

### Los jobs

El test hace fallar una reacción propia, con un intento, mientras "el servidor de correo
está caído". Luego encuentra el job muerto, arregla la causa, lo reintenta y comprueba que
se ejecutó. Crea `modules/job/job.test.ts`:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('job', () => {
  let t: TestBackoffice
  let sam: UserDTO

  beforeEach(async () => {
    t = await openTestBackoffice()
    sam = await t.staffMember('Sam')
  })

  afterEach(() => t.close())

  test('a job of boards that dies is listed with its last error, retried, and then done', async () => {
    const tenant = await t.as(sam, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    await t.settled()
    // A reaction to boards' cards that fails while the "mail server" is down, at its only attempt.
    // It is the test's own, of no module: its queue names none.
    let down = true
    t.boards.modules.card.events.created.subscribe(() => {
      if (down) throw new Error('the mail server is down')
    // eslint-disable-next-line newt/queue-name
    }, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
    await t.board(sam, tenant.id, 'Roadmap', ['One'])
    await t.settled()

    const dead = await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))
    expect(dead.items).toEqual([expect.objectContaining({
      context: 'boards',
      queue: 'test.tellSomeone.on.card.created',
      event: 'card.created',
      attempts: 1,
      lastError: expect.stringContaining('the mail server is down'),
    })])
    expect((await t.as(sam, () => t.modules.job.dead('auth', { size: 10 }))).items).toEqual([])

    down = false
    await t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))
    await t.settled()

    expect((await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))).total).toBe(0)
    const jobs = await t.boards.base.store.outbox.list()
    expect(jobs.find(job => job.id === dead.items[0]!.id)?.status).toBe('done')
    // Done is done: it is not run again.
    await expect(t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))).rejects.toMatchObject({ code: 'outbox.job_not_dead', status: 409 })
  })

  test('a job that is not there, or a context that is not one, is refused', async () => {
    await expect(t.as(sam, () => t.modules.job.retry('auth', '0190a0a0-0000-7000-8000-000000000000'))).rejects.toMatchObject({ code: 'outbox.job_not_found', status: 404 })
    // The backoffice's own outbox, in the same context, is reached the same way.
    await expect(t.as(sam, () => t.modules.job.retry('backoffice', '0190a0a0-0000-7000-8000-000000000000'))).rejects.toMatchObject({ code: 'outbox.job_not_found', status: 404 })
    await expect(t.as(sam, () => t.modules.job.dead('nowhere' as 'auth', { size: 10 }))).rejects.toThrow()
  })
})
```

La suscripción es del propio test, en el emisor de boards: su job va al outbox de boards
como cualquier reacción de boards. Su cola no nombra ningún módulo de cooper, así que el
test desactiva la regla queue-name en esa línea, y dice por qué.

El capítulo 12 probó la misma historia dentro de boards, en `card.test.ts`, con el módulo
outbox de boards. Este test la cubre a través del backoffice, así que borra aquel: en
`cooper/backend/contexts/boards/modules/card/card.test.ts`, quita el último test, `'a
reaction that keeps failing dies after its attempts, is listed, and runs once retried'`,
entero.

Reintentar es solo la mitad. Un job está muerto porque algo va mal: lee su `lastError`,
arregla eso, y solo entonces reintenta. Reintentar antes solo lo mata otra vez.

### Las métricas

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CardDTO } from '../../../boards/modules/card/card.schema'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('metric', () => {
  let t: TestBackoffice

  beforeEach(async () => {
    t = await openTestBackoffice()
  })

  afterEach(() => t.close())

  const today = () => new Date().toISOString().slice(0, 10)

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
    expect(overview.cardsPerDay).toHaveLength(30)
    expect(overview.cardsPerDay.at(-1)).toEqual({ day: today(), count: cards })
    expect(overview.workspacesPerDay.at(-1)).toEqual({ day: today(), count: 1 })
    expect(overview.signUpsPerDay.slice(0, -1).every(day => day.count === 0)).toBe(true)
  })

  test('counts by the day of the context\'s clock, and shows the days up to its today', async () => {
    await t.close()
    let time = Date.parse('2027-03-15T12:00:00Z')
    t = await openTestBackoffice({ clock: { now: () => new Date(time) } })
    const sam = await t.staffMember('Sam')
    await t.settled()

    expect((await t.as(sam, () => t.modules.metric.overview())).signUpsPerDay.at(-1)).toEqual({ day: '2027-03-15', count: 1 })

    time += 2 * 24 * 60 * 60_000
    const { signUpsPerDay } = await t.as(sam, () => t.modules.metric.overview())
    expect(signUpsPerDay.slice(-3)).toEqual([{ day: '2027-03-15', count: 1 }, { day: '2027-03-16', count: 0 }, { day: '2027-03-17', count: 0 }])
  })

  test('counts a card once, however many times its worker runs', async () => {
    const card = { id: '0190a0a0-0000-7000-8000-000000000001', workspaceId: 'w', createdAt: new Date().toISOString() } as CardDTO
    await t.modules.metric.recordCard(card)
    await t.modules.metric.recordCard(card)

    const sam = await t.staffMember('Sam')
    expect((await t.as(sam, () => t.modules.metric.overview())).totals.cards).toBe(1)
  })
})
```

- El primer test dice que las cifras van **un momento por detrás**: cero hasta que se
  ejecutaron los workers, y luego lo que tienen auth y boards. Un workspace nuevo tiene un
  tablero de bienvenida con tarjetas, así que las tarjetas se comparan con el conteo propio
  de boards.
- El segundo da un reloj a cada contexto ([capítulo 19](./19-invitations-and-time)), lo
  mueve dos días, y ve moverse los días con él, incluidos los vacíos.
- El tercero llama a `recordCard` dos veces con la misma tarjeta, como haría un worker
  ejecutado dos veces: cuenta una.

### La API

`backoffice.context.test.ts` también pregunta a las dos rutas nuevas: 401 sin sesión, 200 al
personal, 403 tras quitarle el acceso. Cambia las dos listas de rutas:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.test.ts
// …
    for (const path of ['/api/session', '/api/workspaces', '/api/users', '/api/staff', '/api/metrics', '/api/jobs/boards']) {
// …
    for (const path of ['/api/session', '/api/workspaces', '/api/users/' + sam.id, '/api/staff', '/api/metrics']) {
// …
```

## El frontend del backoffice

La API está completa, así que el backoffice recibe su frontend. Como el de boards en el
[capítulo 23](./23-frontends), se copia del repositorio. Copia la app y sus clientes de API
desde la etiqueta de este capítulo:

```sh
git checkout tutorial/26 -- cooper/frontend/backoffice cooper/libs/api/backoffice-job cooper/libs/api/backoffice-metric cooper/libs/api/backoffice-staff cooper/libs/api/backoffice-user cooper/libs/api/backoffice-workspace
```

```
cooper/
  frontend/
    backoffice/            la consola del personal: index.html, main.tsx, app.routes.tsx, vite.config.ts
      guards/              el guard de la sesión: iniciar sesión ocurre en auth
      modules/             resumen, workspaces, usuarios, personal, jobs: una zona cada uno, perezosas
      pages/               el shell, iniciar sesión, no encontrada, el error de una ruta
      services/session/    quién ha iniciado sesión, de GET /api/session
  libs/
    api/
      backoffice-job/      un cliente por módulo del backoffice: BackofficeJobApi…
      backoffice-metric/
      backoffice-staff/
      backoffice-user/
      backoffice-workspace/
```

Se construye como las apps del capítulo 23: `@cooper/ui` para cada componente,
`@cooper/core` para los stores, un `Requester` por módulo en `@cooper/api`. Cada cliente
importa el esquema de su módulo del backend, así que el frontend y la API comparten un
contrato. Por ejemplo, el cliente de jobs:

```ts
// cooper/libs/api/backoffice-job/backoffice-job.api.ts
import type { ContextJobDTO, JobContext } from '../../../backend/contexts/backoffice/modules/job/job.schema'
import type { Page } from 'newt/contract'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backoffice's `job` module: the jobs that died in each context. */
export class BackofficeJobApi extends Requester {
  protected readonly path = '/jobs'

  /** A context's dead jobs, the newest first. */
  dead(context: JobContext, page?: PageRequest) {
    return this.get<Page<ContextJobDTO>>(`/${context}`, page)
  }

  /** Puts a dead job back to run: a 409 `outbox.job_not_dead` if it is not dead any more. */
  retry(context: JobContext, jobId: string) {
    return this.post<void>(`/${context}/${jobId}/retry`)
  }
}
```

El resumen muestra `GET /api/metrics` y los tableros creados más recientemente; la página de
jobs tiene una pestaña por contexto de `JOB_CONTEXTS`, cada una una lista con un botón de
reintentar.

El resto está tipado. La configuración compartida de Vite aprende el nombre de la tercera
app y el puerto de su backend, en `vite-app.ts`:

```ts
// cooper/frontend/vite-app.ts
// …
  name: 'auth' | 'boards' | 'backoffice'
// …
const BACKEND_PORTS = { auth: 3001, boards: 3002, backoffice: 3003 } as const
// …
/**
 * What the three apps share: React, Tailwind, the aliases of cooper's libraries,
 * a fixed dev port that proxies to the app's context, and the build in
 * `dist/cooper/<name>`, which that context serves in production.
 */
// …
```

El `vite.config.ts` propio de la app, que copiaste, le da el puerto 5173 y hace proxy de
`/api`: el backoffice no sirve nada fuera de su API.

`bun run cooper` arranca el tercer servidor de Vite y comprueba sus puertos. En
`cooper/scripts/dev.ts`:

```ts
// cooper/scripts/dev.ts
// …
const frontend = (name: 'auth' | 'boards' | 'backoffice') => {
// …
const SERVICES = [
  frontend('auth'),
  frontend('boards'),
  frontend('backoffice'),
// …
  ...(['auth', 'boards', 'backoffice'] as const).map(name => ({ name: `${name} API`, port: config[name].port })),
// …
  const names = ['auth', 'boards', 'backoffice'] as const
// …
```

`bun run cooper:build` también lo construye. En el `package.json` de la raíz:

```json
"cooper:build": "vite build cooper/frontend/auth && vite build cooper/frontend/boards && vite build cooper/frontend/backoffice"
```

Una vez construido, el contexto backoffice sirve `dist/cooper/backoffice` para toda
dirección que su API no toma: `frontendFolder` está en su configuración desde el capítulo 25.

## Una cuenta del personal en el seed

El personal no se registra en el backoffice: auth rechaza las cuentas nuevas para él.
Alguien debe recibir acceso primero, y lo hace el seed, como lo hace `staffMember` en los
tests: una cuenta, admitida con `access.admit`, que no comprueba ningún actor. En
`cooper/scripts/seed.ts`, el comentario inicial lo nombra, y el seed importa `PRODUCTS`,
los ids de los productos de auth:

```ts
// cooper/scripts/seed.ts
// bun run cooper:seed: cooper's demo data, written through the contexts' use cases as
// anyone would: a staff user with access to the backoffice, and Ana's workspace Acme,
// where Bob joined by accepting her invitation. Safe to run again: what is there stays.
// …
import { config } from '../backend/config'
import { PRODUCTS } from '../backend/contexts/auth/modules/product/product.schema'
import { inWorkspace } from '../backend/contexts/boards/workspace-scope'
// …
```

créala antes que Ana:

```ts
// cooper/scripts/seed.ts
// …
  const account = async (email: string, name: string) => (await user.findByEmail(email)) ?? user.signUp({ email, name, password: PASSWORD })

  const staff = await account('staff@cooper.dev', 'Cooper Staff')
  await access.admit({ userId: staff.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })

  const ana = await account('ana@cooper.dev', 'Ana García')
// …
```

e imprime su línea con las demás:

```ts
// cooper/scripts/seed.ts
// …
    '',
    `  staff@cooper.dev   the staff: the backoffice, ${config.backoffice.publicUrl}`,
    `  ana@cooper.dev     Acme's admin, ${config.boards.publicUrl}: its boards Welcome and Launch`,
// …
```

`account` encuentra la cuenta si está, y `admit`, dado dos veces, la da una: ejecutado otra
vez, el seed no cambia nada. El seed abre todos los contextos, así que sus registros, su
workspace y sus tarjetas los cuentan los workers de métricas como los de cualquiera.

## Compruébalo

La comprobación:

```sh
bun install && bun check && bun test cooper && bun run lint && bun run cooper:build
```

Los tests del backoffice y los del adaptador:

```sh
bun test cooper/backend/contexts/backoffice cooper/backend/shared/analytics
```

```text
 24 pass
 0 fail
 92 expect() calls
Ran 24 tests across 8 files.
```

Haz el seed, y arranca el servidor:

```sh
bun run cooper:seed
bun cooper/backend/index.ts
```

```text
…
cooper is seeded. Every account's password is
  cooper-demo

  staff@cooper.dev   the staff: the backoffice, http://localhost:5173
  ana@cooper.dev     Acme's admin, http://localhost:5172: its boards Welcome and Launch
  bob@cooper.dev     a member of Acme, who accepted Ana's invitation
…
```

Las métricas quieren a alguien con sesión, y el backoffice ahora sirve su frontend
construido para cualquier otra dirección:

```sh
curl -i localhost:3003/api/metrics
curl -s localhost:3003/ | grep -o '<title>.*</title>'
```

```text
HTTP/1.1 401 Unauthorized
…

{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
<title>Cooper Backoffice</title>
```

### Iniciar sesión con curl

El inicio de sesión pasa por las páginas de auth, que viven detrás de las URLs públicas de
los servidores de Vite. Para recorrerlo con curl solo contra las APIs, arranca el servidor
con cada URL pública apuntando al puerto de su propio contexto, para que cada redirección
caiga en una API. Deténlo, y arráncalo otra vez:

```sh
COOPER_AUTH_PUBLIC_URL=http://localhost:3001 COOPER_BOARDS_PUBLIC_URL=http://localhost:3002 COOPER_BACKOFFICE_PUBLIC_URL=http://localhost:3003 bun cooper/backend/index.ts
```

Luego, con un cookie jar, como lo haría un navegador: empieza en el backoffice, síguelo
hasta auth, inicia sesión allí como el personal, di que sí, y sigue a auth de vuelta:

```sh
J=$(mktemp)
L1=$(curl -s -c $J -b $J -o /dev/null -w '%{redirect_url}' "localhost:3003/api/session/sign-in?returnTo=/")
L2=$(curl -s -c $J -b $J -o /dev/null -w '%{redirect_url}' "$L1")
ID=${L2##*/authorize/}
curl -s -c $J -b $J -X POST localhost:3001/api/session/sign-in -H 'content-type: application/json' -d '{"email":"staff@cooper.dev","password":"cooper-demo"}' > /dev/null
BACK=$(curl -s -c $J -b $J -X POST localhost:3001/api/authorizations/$ID/approve | sed 's/.*"redirectTo":"\([^"]*\)".*/\1/')
curl -s -c $J -b $J -o /dev/null -w '%{http_code} %{redirect_url}\n' "$BACK"
```

```text
302 http://localhost:3003/
```

El jar ya guarda la cookie de sesión del backoffice. Pregunta a la API:

```sh
curl -s -b $J localhost:3003/api/session
curl -s -b $J localhost:3003/api/workspaces
curl -s -b $J localhost:3003/api/metrics
curl -s -b $J localhost:3003/api/jobs/boards
curl -s -b $J localhost:3003/api/jobs/nowhere
```

```text
{"user":{"id":"01a1…","email":"staff@cooper.dev","name":"Cooper Staff",…}}
{"items":[{"id":"01a1…","name":"Acme","createdAt":"…","admin":{"id":"01a1…","name":"Ana García","email":"ana@cooper.dev"},"cards":7}],"hasMore":false,"total":1}
{"totals":{"cards":7,"workspaces":1,"signUps":3},"cardsPerDay":[{"day":"2026-09-27","count":0},…],…}
{"items":[],"hasMore":false,"total":0}
{"error":"Some of what was sent is not right: check the fields and try again","code":"validation","issues":[{"code":"invalid_value","values":["auth","boards","backoffice"],"path":[],"message":"Invalid option: expected one of \"auth\"|\"boards\"|\"backoffice\""}]}
```

Los tres registros del seed, su workspace y sus siete tarjetas los contaron los workers de
métricas mientras se ejecutaba el seed. Ningún job murió, así que la página de boards está
vacía. El mismo recorrido como `ana@cooper.dev` se detiene en la aprobación, con el 403 de
auth `oauthGrant.no_access`.

### En el navegador

Detén el servidor, y arranca cooper con sus frontends:

```sh
bun run cooper
```

Abre `http://localhost:5173`, inicia sesión en auth como `staff@cooper.dev` con la
contraseña del seed, y llegas al resumen: los totales, un gráfico por serie, los tableros
creados más recientemente. Busca Acme en Workspaces, a Ana en Usuarios, concede acceso a
alguien en Personal, y abre Jobs: una pestaña por contexto, cada una vacía hasta que muere
un job.

## Qué recordar

- **Cada contexto guarda y ejecuta sus propios jobs.** Quien cuida de ellos pasa por los
  casos de uso de ese contexto (`outbox.dead`, `outbox.retry`, sobre el `list`, `get` y
  `retry` del puerto), nunca por su store. Un job muerto se reintenta una vez arreglado lo
  que lo mató, y un job que no está muerto nunca se ejecuta otra vez.
- **La analítica es una proyección**: workers `handler` siguen los eventos y hacen `append`
  de filas por el id de lo que cuentan, así que un worker ejecutado dos veces cuenta una.
  Van un momento por detrás, y nunca dentro de la transacción de un contexto.
- **El puerto de newt solo añade; leer es cosa del adaptador.** Declara las preguntas que
  haces en una interfaz propia (`AnalyticsCounts`), y haz que el módulo reciba las dos.
- **Un adaptador pasa el contrato del puerto**: `describeAnalyticsContract` para la
  analítica, con `MemoryAnalytics` como el ejemplo más simple y un sustituto para tests.
- **Un job vive en el outbox del guardado que contó su evento**: los jobs de métricas son los
  de auth y de boards, no los del backoffice, y también lo son los muertos.

Siguiente: [Postgres, MySQL y las migraciones en producción](./27-postgres).
