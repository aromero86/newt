# D. Escribir un store

newt guarda los datos de un contexto detrás de un puerto, `Store`, de `newt/port-store`.
cooper usa tres adaptadores suyos: `FileStore` en sus primeros capítulos, `SqliteStore`
desde el [capítulo 5](./05-sqlite), y `PostgresStore` (o `MySqlStore`) en producción
([capítulo 27](./27-postgres)). Ningún módulo, repositorio ni caso de uso cambió cuando
cambió el store: solo conocen el puerto.

Este apéndice escribe un cuarto adaptador, un store en memoria, y lo demuestra con la
suite que pasa todo adaptador de newt, `describeStoreContract`. El código de aquí no es
parte de cooper; vive solo en este apéndice. El store entero está debajo, unas 270
líneas, y pasa los 87 tests de la suite.

¿Cuándo escribirías uno? Para una base de datos para la que newt no tiene adaptador, o
para un store con otras ventajas e inconvenientes (uno para tests, uno sobre un servicio
clave-valor). Para otra base de datos SQL, parte de `newt/sql`, como hacen los
adaptadores de Postgres y MySQL (mira [el final](#a-sql-database)).

## Lo que promete un store

`Store` es pequeño:

```ts
export interface Store {
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
  guard(keys: string[]): Promise<void>
  afterCommit(fn: () => void): void
  afterRollback(fn: () => void): void
  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): Table<Row>
  readonly outbox: Outbox
  readonly migrations: Migrations
  close(): Promise<void>
}
```

Lo que promete no lo es. Todo adaptador cumple esto, y la suite comprueba cada punto:

- **Una transacción es todo o nada**, con los jobs del outbox incluidos. Una llamada
  dentro de una se une a ella: solo hay siempre la más externa.
- **La transacción actual sigue al código**, a través de los `await`, sin que se la
  pasen.
- **Las transacciones que protegen la misma clave nunca se entrelazan**, así que una
  regla sobre varias filas ([capítulo 6](./06-rules-over-rows)) se cumple en todos los
  stores.
- **Las lecturas fuera de una transacción ven solo lo confirmado.**
- **Una fila guardada conserva su versión**: una escritura que encuentra otra lanza
  `ConcurrencyConflict`; una fila nueva cuyo id o valor único está tomado lanza
  `DuplicateValue` ([capítulo 8](./08-two-people-one-card)).

Una tabla, `Table<Row>`, es sobre lo que trabaja `TableRepository`: `find` y `count` por
`Criteria`, `insert`, `update` y `delete` por versión, `patch` sea cual sea la versión, y
`deleteMany` por criterios. El outbox, `Outbox` de `newt/port-outbox`, es donde se
guardan los jobs `'handler'`, en el mismo almacenamiento que los datos, de modo que un
job se escribe en la transacción del cambio que lo publica
([capítulo 11](./11-reacting)).

## Preparación

El store es un proyecto propio, que depende de `newt` y `zod`: un archivo fuente,
`memory-store.ts`, y un test, `memory-store.test.ts`. Las secciones de abajo son
`memory-store.ts` de arriba abajo.

## El store: TransactionScope

Las promesas más difíciles tratan de las transacciones, y newt da la maquinaria para
ellas: `TransactionScope`, de `newt/port-store`. Ejecuta las transacciones una a una, en
el orden en que lo piden; guarda la actual en un `AsyncLocalStorage`, así que una llamada
dentro de una se une a ella; la cierra en cuanto empieza a confirmarse, de modo que una
llamada tardía falla en vez de ejecutarse fuera de ella; ejecuta los callbacks
`afterCommit` y `afterRollback`; y hace fallar una llamada que espera demasiado, diciendo
por qué. Su `State` es lo que sea que el adaptador guarda por cada transacción.

Un adaptador le da a `run` sus pasos: `begin`, `commit`, `rollback` y un `end`
opcional. Como el scope ejecuta una transacción a la vez, `guard` no necesita más que
estar en una; un store cuyas transacciones se ejecutan en paralelo (Postgres) pasa
`serial: false` y toma él mismo un bloqueo por clave.

Aquí, cada tabla es un `Map` de filas por id. Una transacción escribe en su propia copia
de cada tabla que toca (su `State`), y su commit pone esas copias en lugar de las
confirmadas. Una lectura fuera de una transacción ve las tablas confirmadas, así que
nunca ve lo que no está confirmado; una dentro ve las copias de la transacción, así que
lee lo que escribió.

```ts
import { compare, ConcurrencyConflict, DuplicateValue, matches, type Criteria } from 'newt/core'
import { isSameClaim, type Job, type JobClosing, type JobQuery, type JobQueueRegistration, type Outbox } from 'newt/port-outbox'
import { noteRead, TransactionScope, type FindOptions, type Migrations, type NewRow, type Store, type StoredRow, type Table, type TableOptions } from 'newt/port-store'

type Row = Record<string, unknown>
/** A table's rows, by id. */
type Rows = Map<string, Row>
/** What a transaction writes: its own copy of each table it touched. */
type Staged = Map<string, Rows>

/**
 * A store in memory: every table a map of rows, gone when the process ends. For tests
 * and examples, not for data you keep. Its transactions take turns (TransactionScope),
 * so guarding a key needs nothing more than being in one; each one writes to copies
 * of the tables it touches, which replace the committed ones when it commits.
 */
export class MemoryStore implements Store {

  readonly outbox: Outbox = new MemoryOutbox(this)
  readonly migrations: Migrations = new NoMigrations()

  private committed = new Map<string, Rows>()
  private readonly scope = new TransactionScope<Staged>()

  static async open(): Promise<MemoryStore> {
    return new MemoryStore()
  }

  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const staged: Staged = new Map()
    return this.scope.run(fn, staged, {
      begin: () => {},
      commit: () => { for (const [name, rows] of staged) this.committed.set(name, rows) },
      rollback: () => {},
    })
  }

  guard(keys: string[]): Promise<void> {
    return this.scope.guard(keys)
  }

  afterCommit(fn: () => void): void {
    this.scope.afterCommit(fn)
  }

  afterRollback(fn: () => void): void {
    this.scope.afterRollback(fn)
  }

  table<R extends StoredRow>(name: string, options?: TableOptions<R>): Table<R> {
    return new MemoryTable<R>(this, name, options)
  }

  async close(): Promise<void> {
    await this.scope.drain()
  }

  /** A table's rows as this code sees them: the transaction's copy, else the committed ones. */
  read(name: string): Rows {
    this.scope.assertNotEnded()
    return this.scope.state?.get(name) ?? this.committed.get(name) ?? new Map()
  }

  /** A table's rows to write, in the transaction in progress: its own copy, made the first time. */
  write(name: string): Rows {
    this.scope.assertNotEnded()
    const staged = this.scope.state
    if (!staged) throw new Error('A write runs inside store.transaction')
    let rows = staged.get(name)
    if (!rows) staged.set(name, rows = new Map(this.committed.get(name)))
    return rows
  }
}
```

`read` y `write` son la API propia del store, para su tabla y su outbox. Las dos empiezan
con `assertNotEnded`: una llamada que pertenece a una transacción que ha terminado falla
con el mensaje de newt ("This call belongs to a transaction that has ended…").

## Tablas: criterios, versiones, valores únicos

`find` y `count` reciben `Criteria`, las mismas palabras que todo store responde igual
([capítulo 15](./15-kysely)). Un store que comprueba las filas una a una las responde con
`matches(row, criteria)`, de `newt/core`: responde lo que respondería SQL, así que una
comparación con `null` no se cumple para nada, y `ieq` ignora solo la capitalización de A
a Z. La ordenación usa `compare`, que ordena el texto por code point y pone `null`
primero en orden ascendente.

Cada tabla también llama a `noteRead(name)` al hacer `find` y `count`. Así funciona la
regla del guard en todos los stores: un guardado que no protege nada y lee filas se
rechaza ([capítulo 6](./06-rules-over-rows)).

Las escrituras mantienen las versiones: `insert` da la versión 1, `update` y `delete`
necesitan la versión que leyó quien llama, `patch` la deja como está.
`TableOptions.unique` lista los campos que no comparten dos filas, sin contar una fila
borrada de forma lógica (soft delete); un store cuya estructura ya lo dice (un índice
único) lo ignora.

```ts
class MemoryTable<R extends StoredRow> implements Table<R> {

  constructor(private readonly store: MemoryStore, private readonly name: string, private readonly options: TableOptions<R> = {}) {}

  async find(criteria?: Criteria<R>, options: FindOptions<R> = {}): Promise<R[]> {
    if (options.limit !== undefined && !(Number.isInteger(options.limit) && options.limit >= 0)) throw new Error(`A limit is a whole number, 0 or more: not ${options.limit}`)
    const order = options.orderBy ?? [{ field: 'id' }]
    const rows = this.rows(criteria).sort((a, b) => {
      for (const { field, direction } of order) {
        const by = compare(a[field], b[field])
        if (by !== 0) return direction === 'desc' ? -by : by
      }
      return 0
    })
    noteRead(this.name)
    return options.limit === undefined ? rows : rows.slice(0, options.limit)
  }

  async count(criteria?: Criteria<R>): Promise<number> {
    noteRead(this.name)
    return this.rows(criteria).length
  }

  insert(row: NewRow<R>): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      if (rows.has(row.id)) throw new DuplicateValue(['id'])
      this.put(rows, { ...defined(row), version: 1 })
    })
  }

  update(id: string, version: number, changes: Partial<NewRow<R>>): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      const current = rows.get(id)
      if (current?.version !== version) throw new ConcurrencyConflict()
      this.put(rows, { ...current, ...defined(changes), id, version: version + 1 })
    })
  }

  patch(id: string, changes: Partial<NewRow<R>>): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      const current = rows.get(id)
      if (!current) return
      const { id: _, version: __, ...fields } = defined(changes)
      this.put(rows, { ...current, ...fields })
    })
  }

  delete(id: string, version: number): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      if (rows.get(id)?.version !== version) throw new ConcurrencyConflict()
      rows.delete(id)
    })
  }

  deleteMany(criteria: Criteria<R>): Promise<number> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      const gone = [...rows.values()].filter(row => matches(row, criteria as Criteria<Row>))
      for (const row of gone) rows.delete(row.id as string)
      return gone.length
    })
  }

  /**
   * Runs a write in the transaction in progress, or in one of its own, a turn of the
   * event loop later, as a store that waits for its disk would: a write still in flight
   * when its transaction ends then fails, instead of landing in it.
   */
  private writing<T>(fn: () => T): Promise<T> {
    return this.store.transaction(async () => {
      await Bun.sleep(0)
      return fn()
    })
  }

  /** Copies of the rows that meet the criteria: what a caller changes is not what is kept. */
  private rows(criteria?: Criteria<R>): R[] {
    return [...this.store.read(this.name).values()].filter(row => matches(row, criteria as Criteria<Row>)).map(row => structuredClone(row) as R)
  }

  /** Keeps a copy of the row, once no other row has its value in a unique set of fields. */
  private put(rows: Rows, row: Row): void {
    if (row.deletedAt === null || row.deletedAt === undefined) {
      for (const fields of this.options.unique ?? []) {
        if (fields.some(field => row[field] === null || row[field] === undefined)) continue
        const taken = [...rows.values()].some(other => other.id !== row.id && (other.deletedAt ?? null) === null && fields.every(field => other[field] === row[field]))
        if (taken) throw new DuplicateValue(fields)
      }
    }
    rows.set(row.id as string, structuredClone(row))
  }
}
```

`writing` espera un turno del bucle de eventos antes de escribir. Un store que habla con
un disco o un servidor lo hace de todos modos; uno en memoria debe hacerlo a propósito,
o una escritura todavía en vuelo cuando su transacción se revierte aterrizaría en la
copia descartada en vez de fallar como espera la suite. Cada valor se copia al entrar y
al salir (`structuredClone`), así que lo que cambia quien llama no es lo que se guarda.

## Migraciones

Un store recuerda los cambios de su estructura (`Migrations`: `up`, `down`, `status`).
Un store en memoria no tiene estructura que cambiar, así que sus migraciones son
ninguna:

```ts
/** An in-memory store has no structure to change: nothing to migrate. */
class NoMigrations implements Migrations {
  async up(): Promise<string[]> { return [] }
  async down(): Promise<string | null> { return null }
  async status(): Promise<{ applied: string[], pending: string[] }> { return { applied: [], pending: [] } }
}
```

Un store real aplica aquí sus scripts, en orden, todos o ninguno, y guarda de cada uno su
nombre y un checksum. newt da las dos cosas: `migrationName(3, 'product-code')` es
`00003_product-code`, y `migrationChecksum(script)` es el SHA-256 que el store compara al
abrirse, rechazando una migración cambiada después de aplicarse
([capítulo 5](./05-sqlite)).

## El outbox

El outbox es la parte con la que habla un worker (`JobQueue`). Guarda `Job`s en el mismo
almacenamiento que los datos: aquí, dos tablas más del store, `_jobs` y `_job_queues`, de
modo que `add` dentro de un guardado escribe sus jobs en la transacción del guardado y
una reversión se los lleva consigo.

- `claim` toma hasta `limit` jobs de algunas colas, pendientes y que ya les toca, o en
  ejecución con su lease agotado, a fecha de `now` (el reloj del worker); cada claim
  cuenta un intento más y queda bloqueado por `worker`, un nombre que ningún claim usó
  antes.
- `renew` y `close` cambian un job solo mientras siga siendo el claim que era:
  `isSameClaim`, de `newt/port-outbox`, compara estado, `lockedBy` e `attempts`, así que
  un worker cuyo lease se agotó no puede cerrar lo que otro ha tomado.
- `retry` devuelve un job muerto a nuevo; `purge` olvida los jobs terminados antes de
  una hora; `list`, `get`, `waiting` y `queues` son para quien cuida de los jobs
  ([capítulo 12](./12-failures), [capítulo 26](./26-dead-jobs-and-analytics)).

```ts
/** The outbox, as two more tables of the store: its jobs are written in the transaction of the change. */
class MemoryOutbox implements Outbox {

  constructor(private readonly store: MemoryStore) {}

  add(jobs: Job[]): Promise<void> {
    return this.store.transaction(() => {
      for (const job of jobs) this.store.write('_jobs').set(job.id, structuredClone(job))
    })
  }

  claim(queues: string[], limit: number, worker: string, leaseUntil: string, now = new Date().toISOString()): Promise<Job[]> {
    return this.store.transaction(() => {
      const claimed = this.jobs()
        .filter(job => queues.includes(job.queue))
        .filter(job => (job.status === 'pending' && job.runAfter <= now) || (job.status === 'running' && job.lockedUntil !== null && job.lockedUntil < now))
        .sort((a, b) => compare(a.runAfter, b.runAfter))
        .slice(0, limit)
        .map(job => ({ ...job, status: 'running' as const, lockedBy: worker, lockedUntil: leaseUntil, attempts: job.attempts + 1, updatedAt: now }))
      for (const job of claimed) this.store.write('_jobs').set(job.id, job)
      return claimed.map(job => structuredClone(job))
    })
  }

  renew(claimed: Job, leaseUntil: string): Promise<void> {
    return this.onClaim(claimed, job => ({ ...job, lockedUntil: leaseUntil }))
  }

  close(claimed: Job, closing: JobClosing): Promise<void> {
    return this.onClaim(claimed, job => ({ ...job, status: closing.status, lastError: closing.lastError, runAfter: closing.runAfter ?? job.runAfter, lockedBy: null, lockedUntil: null }))
  }

  retry(id: string): Promise<boolean> {
    const now = new Date().toISOString()
    return this.store.transaction(() => {
      const stored = this.store.read('_jobs').get(id) as Job | undefined
      if (stored?.status !== 'dead') return false
      this.store.write('_jobs').set(id, { ...stored, status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, updatedAt: now })
      return true
    })
  }

  seen(queues: JobQueueRegistration[]): Promise<void> {
    const now = new Date().toISOString()
    return this.store.transaction(() => {
      for (const queue of queues) this.store.write('_job_queues').set(queue.name, { ...queue, lastSeenAt: now })
    })
  }

  purge(before: string): Promise<void> {
    return this.store.transaction(() => {
      for (const job of this.jobs()) if (job.status === 'done' && job.updatedAt < before) this.store.write('_jobs').delete(job.id)
    })
  }

  async list({ status, after, limit }: JobQuery = {}): Promise<Job[]> {
    const all = this.jobs().sort((a, b) => compare(a.createdAt, b.createdAt) || compare(a.id, b.id))
    const from = after === undefined ? 0 : (all.findIndex(job => job.id === after) + 1 || all.length)
    const found = all.slice(from).filter(job => status === undefined || job.status === status)
    return limit === undefined ? found : found.slice(0, limit)
  }

  async get(id: string): Promise<Job | undefined> {
    const job = this.store.read('_jobs').get(id)
    return job && structuredClone(job) as Job
  }

  async waiting(): Promise<{ queue: string, jobs: number }[]> {
    const counts = new Map<string, number>()
    for (const job of this.jobs()) if (job.status === 'pending' || job.status === 'running') counts.set(job.queue, (counts.get(job.queue) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => compare(a, b)).map(([queue, jobs]) => ({ queue, jobs }))
  }

  async queues(): Promise<(JobQueueRegistration & { lastSeenAt: string })[]> {
    return [...this.store.read('_job_queues').values()].map(each => structuredClone(each) as JobQueueRegistration & { lastSeenAt: string }).sort((a, b) => compare(a.name, b.name))
  }

  private jobs(): Job[] {
    return [...this.store.read('_jobs').values()].map(job => structuredClone(job) as Job)
  }

  /** A write on a claimed job, only while it is still the claim it was (isSameClaim). */
  private onClaim(claimed: Job, change: (job: Job) => Job): Promise<void> {
    return this.store.transaction(() => {
      const stored = this.store.read('_jobs').get(claimed.id) as Job | undefined
      if (stored && isSameClaim(stored, claimed)) this.store.write('_jobs').set(stored.id, { ...change(stored), updatedAt: new Date().toISOString() })
    })
  }
}

function defined(values: object): Row {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}
```

## Demostrarlo: describeStoreContract

`newt/port-store/contract` tiene la suite. Recibe un nombre y un fixture, un
`StoreFixture`: un `open` que da un store nuevo y vacío cada vez, que la suite cierra.
Este es todo `memory-store.test.ts`:

```ts
import { describeStoreContract } from 'newt/port-store/contract'
import { MemoryStore } from './memory-store'

describeStoreContract('MemoryStore', { open: () => MemoryStore.open() })
```

La suite trabaja con una tabla, `thing`, de `ThingRow`s: un id, un espacio de trabajo,
un `name` único, un booleano, un número, una nota que admite null, una lista JSON de
tags, las fechas y una versión. La pide como `store.table<ThingRow>('thing', { types: {
archived: 'boolean', tags: 'json' }, unique: [['name']] })`. Un store cuya estructura se
declara de antemano crea esa tabla en su fixture: cada campo una columna en snake case,
`name` único entre las filas cuyo `deleted_at` es null, y el texto ordenado por code
point (`COLLATE "C"` en Postgres, `utf8mb4_0900_bin` en MySQL). El propio test SQLite de
newt lo hace con una migración:

```sql
CREATE TABLE thing (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, archived INTEGER NOT NULL, rank REAL NOT NULL,
  note TEXT, tags TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL
);
CREATE UNIQUE INDEX thing_name ON thing (name) WHERE deleted_at IS NULL
```

El store en memoria no necesita ninguna: una tabla existe en cuanto se escribe algo en
ella.

```sh
bun test
```

```text
 87 pass
 0 fail
 210 expect() calls
Ran 87 tests across 1 file.
```

La suite comprueba, por grupos: una transacción (confirma, revierte, anida, lee sus
propias escrituras, hace fallar las llamadas tardías), aislamiento y guards, `afterCommit`
y `afterRollback`, una tabla (versiones, `DuplicateValue`, borrados lógicos, cada
operador, `null`, `and` y `or` anidados, campos JSON, ordenación por code point), un
`TableRepository` sobre el store (páginas, guardados, la regla del guard, eventos
publicados al confirmar), un repositorio con scope, el cierre, el outbox (claims, leases,
reintentos, purgas, listas), la cola de jobs ejecutándose sobre él, y programaciones que
hacen tick una vez entre procesos. Cuando falla un test, su nombre dice qué promesa se
rompió: dos fallaron en el primer borrador de este store, un `find` que aceptaba un
`limit` de `NaN` y unas escrituras que terminaban antes de que su transacción se
revirtiera, y los dos arreglos están en el código de arriba.

## Usarlo

Un contexto lo recibe como recibe cualquier store: `new Base({ name: 'boards', store })`.
Es la memoria de un solo proceso, que desaparece cuando el proceso termina, así que es
para tests y ejemplos, no para datos que quieras conservar.

## Una base de datos SQL {#a-sql-database}

Para una base de datos SQL, traduce los criterios en vez de comprobar las filas una a una.
`criteriaTree(criteria)`, de `newt/core`, convierte `Criteria` en un árbol de
`CriteriaNode`s: `all` (and), `any` (or), y `field` con su condición, un campo dejado
`undefined` se omite, un valor desnudo se convierte en `eq`:

```ts
criteriaTree({ workspaceId: 'w1', or: [{ rank: { gte: 3 } }, { note: null }] })
```

```json
{
  "kind": "all",
  "of": [
    { "kind": "field", "field": "workspaceId", "condition": { "eq": "w1" } },
    {
      "kind": "any",
      "of": [
        { "kind": "field", "field": "rank", "condition": { "gte": 3 } },
        { "kind": "field", "field": "note", "condition": { "eq": null } }
      ]
    }
  ]
}
```

Un store recorre ese árbol hasta convertirlo en su propia consulta, respondiendo como lo
hace `matches`: `eq: null` es `IS NULL`, `ne` se cumple también para `null`
(`IS DISTINCT FROM`), un `in` con `null` dentro pide `IS NULL` a su lado, un `all` vacío
se cumple para todas las filas y un `any` vacío para ninguna.

No tienes que escribir eso para una base de datos SQL. `newt/sql` tiene el código que
comparten los adaptadores de Postgres y MySQL: `SqlStore` (transacciones sobre un pool de
conexiones, bloqueos advisory para los guards), `SqlTable` (criterios a `WHERE`,
versiones, columnas JSON y booleanas), `SqlOutbox`, `SqlMigrationRunner` (archivos SQL,
checksums) y `splitStatements`. Lo que distingue una base de datos de otra es un
`SqlDialect`: cómo se escribe un parámetro y un nombre, cómo se dicen `ieq` y "difiere
de", cómo se lee una colisión en sus errores. Un adaptador SQL nuevo es sobre todo un
dialecto, y el mismo `describeStoreContract` lo demuestra.
