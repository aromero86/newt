# Reaccionar: handlers y el outbox

La línea en el log se puede perder, y no pasa nada. El **historial** de una tarjeta, no.
cooper muestra, para cada tarjeta, qué le pasó, quién lo hizo y cómo entró: creada por
ana, movida por ana a través de MCP, asignada a bea. Un historial con un hueco es un
bug, y con `fire-and-forget` un hueco está a un fallo de distancia: el movimiento se
guarda, el proceso se detiene antes de que se ejecute el callback, y el historial nunca
se entera.

Escribir el historial dentro de `card.move` tampoco ayudaría. La actividad es otro
módulo, con su propia tabla y su propio guardado: un caso de uso que guardara la tarjeta
y luego la entrada podría fallar entre los dos, y esa es la escritura en otro módulo que
el capítulo [8](./08-two-people-one-card) dijo que solo puede hacer un worker.

Este capítulo añade la estrategia que no pierde nada, **`handler`**. newt escribe un
**job** en la misma transacción que el cambio, y un worker lo ejecuta tras la
confirmación, otra vez si falla, también tras un reinicio. El módulo de actividad
registra cada evento de tarjeta con uno, y verás lo que cuesta: un job puede ejecutarse
más de una vez, así que lo que hace debe poder hacerse dos veces sin problema.

## Un job, guardado con el cambio

Una suscripción con `strategy: 'handler'` es una **cola**. Cada vez que se cuenta su
evento, newt añade un job a esa cola, en la transacción del guardado que lo contó:

```text
una transacción                          tras la confirmación
┌──────────────────────────────────┐
│ card: columnId = Doing           │ ──▶ el worker de boards reclama el job,
│ job:  activity.recordMoved.on.   │     ejecuta activity.recordMoved(move, event),
│       card.moved      (pending)  │     y lo marca como hecho; si lanza un error,
└──────────────────────────────────┘     se ejecuta otra vez más tarde
```

Así el movimiento y el job que lo registra se guardan juntos, o ninguno. No hay un
momento en que la tarjeta se movió y el job no existe. La tabla a la que van es el
**outbox** del contexto: una tabla de jobs en el mismo store que sus datos, `job`, que
`SqliteStore.open` creó con las migraciones propias de newt en el capítulo
[5](./05-sqlite). El job guarda el evento como JSON, tal como se contó, con su payload y
todo.

Tras la confirmación, el **worker** del contexto lo ejecuta. Lo arrancaste en el capítulo
[1](./01-project-and-context): `boards.start()` en `index.ts`. La confirmación lo
despierta, así que un job suele ejecutarse un momento después de su guardado; además
mira cada pocos segundos, y al arrancar, de modo que los jobs que quedaron de antes de un
reinicio también se ejecutan. Un job que lanza un error vuelve a esperar y se ejecuta
otra vez más tarde (el [capítulo siguiente](./12-failures) dice cada cuánto, y cuándo
deja de intentarlo).

El worker ejecuta cada job **desacoplado**: sin actor, sin scope, sin nada de quien
guardó el cambio. Un job lee lo que necesita del evento, como hizo la línea de log.

### Al menos una vez

Un job se ejecuta hasta que tiene éxito. Esa es la garantía, y tiene un precio: puede
ejecutarse **más de una vez**. Entre hacer su trabajo y marcar el job como hecho siempre
hay un momento, y el proceso puede detenerse en él. Cuando el worker vuelve, el job sigue
pendiente, y se ejecuta otra vez. Un job que falló a medias se ejecuta otra vez desde el
principio. Un worker que se quedó congelado más allá de su lease (un minuto, renovado
mientras se ejecuta) pierde el job a favor de otro, y aún puede terminar su propia
ejecución.

Así que lo que haga un handler debe dar el mismo resultado ejecutado dos veces que
ejecutado una: debe ser **idempotente**. Ten esto presente para la actividad: cada
evento de tarjeta debe dar una entrada, se ejecute su job las veces que se ejecute.

## La tabla

Una entrada de la actividad de una tarjeta es una fila, y las filas solo se añaden. El id
de cada fila es el id del evento que registra:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00005_activity_up.sql
-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT,
  via TEXT,
  at TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- A card's activity, the newest first (ids are v7: in the order they were told).
CREATE INDEX activity_card ON activity (workspace_id, card_id, id);
```

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00005_activity_down.sql
DROP TABLE activity;
```

- `actor_id` y `via` son null cuando boards lo hizo por su cuenta (las tarjetas de una
  columna quitada, más adelante).
- `detail` es JSON: qué cambió, según el tipo.
- No hay clave foránea a `card`: una tarjeta borrada conserva su historial.
- El índice lee la actividad de una tarjeta de la más nueva a la más antigua. Los ids son
  UUID v7, ordenados por tiempo, así que ordenar por id es ordenar por cuándo se contó
  cada evento.

## La entrada

Su esquema dice qué es una entrada, y los seis tipos:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.schema.ts
import { z } from 'zod'

/** What can happen to a card: one entry of its activity each. */
export const ACTIVITY_KINDS = ['created', 'edited', 'moved', 'assigned', 'unassigned', 'deleted'] as const

/**
 * Something that happened to a card, once: who did it (`actorId`, null when cooper
 * did it on its own) and how they came in (`via`), and what changed (`detail`). Its
 * id is the id of the event it records, so the same event is recorded once.
 */
export const ActivitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  cardId: z.string(),
  kind: z.enum(ACTIVITY_KINDS),
  actorId: z.string().nullable(),
  via: z.enum(['web', 'mcp']).nullable(),
  /** When it happened: when its event was told. */
  at: z.string(),
  /**
   * What changed, by kind: `number` and `title` (created, deleted), `changed` and
   * `title` (edited), `fromColumnId` and `toColumnId` (moved), `assigneeId` and
   * `previousAssigneeId` (assigned, unassigned).
   */
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type ActivityDTO = z.infer<typeof ActivitySchema>
export type ActivityKind = ActivityDTO['kind']
```

La entidad es la más pequeña de cooper. Se registra una vez, nunca cambia y no cuenta
nada: ella misma es lo que contaron los eventos de una tarjeta.

```ts
// cooper/backend/contexts/boards/modules/activity/activity.ts
import { Entity, type EntityInput } from 'newt/core'
import { ActivitySchema, type ActivityDTO } from './activity.schema'

export * from './activity.schema'

/**
 * An entry of a card's activity. Recorded once and never changed: a log only grows,
 * so two entries written at once never collide. It tells nothing: it is
 * itself what a card's events told.
 */
export class Activity extends Entity<typeof ActivitySchema> {

  private constructor(input: EntityInput<ActivityDTO>, isNew: boolean) {
    super(ActivitySchema, input, isNew)
  }

  static fromDTO(dto: ActivityDTO & { version: number }): Activity {
    return new Activity(dto, false)
  }

  /** A new entry, by the id of the event it records. */
  static record(input: EntityInput<ActivityDTO> & { id: string }): Activity {
    return new Activity(input, true)
  }
}
```

`record` toma el id de fuera, el del evento, en lugar de uno nuevo. Eso es lo que lo hace
idempotente, más abajo.

El repositorio tiene scope de workspace como todo repositorio de boards (capítulo
[4](./04-who-and-where)), y dice que `detail` se guarda como JSON:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Activity, type ActivityDTO } from './activity'

export type ActivityRow = ActivityDTO & { version: number }

export class Activity_Repository extends TableRepository<Activity, ActivityRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<ActivityRow>('activity', { types: { detail: 'json' } }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: ActivityRow): Activity {
    return Activity.fromDTO(row)
  }
}
```

## Los casos de uso

El módulo recibe un repositorio, sus rutas, un caso de uso que lee, y seis que
registran, y su comentario dice lo que es ahora: un log que solo crece. Este es el
`activity.module.ts` entero:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
import { mapPage, Module, UseCase, type EventMeta, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { CardAuthor, CardDTO } from '../card/card.schema'
import type { Card_Assigned } from '../card/events/card-assigned'
import type { Card_Created } from '../card/events/card-created'
import type { Card_Deleted } from '../card/events/card-deleted'
import type { Card_Edited } from '../card/events/card-edited'
import type { Card_Moved } from '../card/events/card-moved'
import type { Card_Unassigned } from '../card/events/card-unassigned'
import { Activity, type ActivityDTO, type ActivityKind } from './activity'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Options } from './activity-options'
import { Activity_Repository } from './activity.repository'
import { registerActivityRoutes } from './activity.routes'
import { registerActivityWorkers } from './activity.workers'

/**
 * What happened to each card, and who did it: a log that only grows, one
 * entry per event a card tells, written by a worker reacting to it. An entry
 * is never changed: a card edited twice has two entries, and none of them collides
 * with another, nor with the card. Each one takes its event's id, so a job that runs
 * twice records it once.
 */
export class Activity_Module extends Module {

  static initialize(base: BoardsBase, deps: Activity_Deps, options: Activity_Options): Activity_Module {
    const module = new Activity_Module(base, new Activity_Repository(base), deps)
    registerActivityRoutes(base, module, deps)
    registerActivityWorkers(module, deps, options)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Activity_Repository, deps: Activity_Deps) {
    super('activity', base.invocations, deps)
  }

  /** A page of a card's activity, the newest first. Its card may be gone: its history stays. */
  @UseCase()
  async listForCard(cardId: string, page: PageRequest): Promise<Page<ActivityDTO>> {
    const found = await this.repo.page({ cardId }, page, { newestFirst: true })
    return mapPage(found, entry => entry.toDTO())
  }

  @UseCase()
  async recordCreated(card: Card_Created['payload'], event: EventMeta): Promise<void> {
    await this.append(card, card, event, 'created', { number: card.number, title: card.title, columnId: card.columnId })
  }

  @UseCase()
  async recordEdited({ dto, changes, ...origin }: Card_Edited['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'edited', { changed: Object.keys(changes).filter(field => field !== 'updatedAt').join(', '), title: dto.title })
  }

  @UseCase()
  async recordMoved({ dto, previous, ...origin }: Card_Moved['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'moved', { fromColumnId: previous.columnId ?? dto.columnId, toColumnId: dto.columnId })
  }

  @UseCase()
  async recordAssigned({ dto, previousAssigneeId, ...origin }: Card_Assigned['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'assigned', { assigneeId: dto.assigneeId, previousAssigneeId })
  }

  @UseCase()
  async recordUnassigned({ dto, previousAssigneeId, ...origin }: Card_Unassigned['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'unassigned', { previousAssigneeId })
  }

  @UseCase()
  async recordDeleted(card: Card_Deleted['payload'], event: EventMeta): Promise<void> {
    await this.append(card, card, event, 'deleted', { number: card.number, title: card.title })
  }

  /**
   * Records an event of a card, in its workspace (a worker is in none), by the event's
   * id: the second time, the entry is there already.
   */
  private async append(card: CardDTO, { by, via }: CardAuthor, event: EventMeta, kind: ActivityKind, detail: ActivityDTO['detail']): Promise<void> {
    await runInWorkspace(card.workspaceId, async () => {
      if (await this.repo.first({ id: event.id })) return
      await this.repo.persist(Activity.record({
        id: event.id,
        workspaceId: card.workspaceId,
        boardId: card.boardId,
        cardId: card.id,
        kind,
        actorId: by,
        via,
        at: event.occurredAt,
        detail,
      }))
    })
  }
}
```

### El id del evento: `EventMeta`

Cada caso de uso `record…` recibe dos cosas: el payload del evento, tipado por la clase
del evento (`Card_Moved['payload']`), y **`EventMeta`**, de `newt/core`: lo demás que se
sabe del evento, su `id`, su `name` y cuándo ocurrió, `occurredAt`.

El id es del publicador: newt da uno a cada evento cuando se cuenta. Es **el mismo para
todos los handlers del evento y para todas las ejecuciones de su job**. Dos ejecuciones
de `activity.recordMoved` para un movimiento ven un mismo id; el job del historial y el
del email (capítulo siguiente) ven también el mismo id. Un movimiento hecho de nuevo más
tarde es otro evento, con otro id.

Eso lo convierte en la **clave de idempotencia** natural: todo lo que un handler deba
hacer una vez por evento, lo hace con clave en el id del evento. La actividad lo toma
como id propio de cada entrada, y `append` comprueba antes de escribir:

- `this.repo.first({ id: event.id })`: si la entrada está ahí, una ejecución anterior la
  registró, y no hay nada que hacer.
- Si no está, escribe la entrada con ese id. Si dos ejecuciones pasaran la comprobación a
  la vez (un worker que perdió su lease, y el que lo relevó), la segunda inserción choca
  con la primera en la clave primaria: el guardado lanza `DuplicateValue`, el caso de uso
  se ejecuta otra vez, encuentra la entrada y vuelve. La tabla nunca tiene dos.

Un handler que usara como clave el payload (el id de la tarjeta y el tipo, por ejemplo)
fundiría dos movimientos reales en uno. El id del evento distingue una vez que se contó
un evento de otra, y nada más lo hace.

`at` es el `occurredAt` del evento, no la hora en que se ejecutó el job: un job que se
ejecuta un minuto tarde registra igualmente cuándo ocurrió.

### Un worker no tiene scope

`append` se ejecuta en `runInWorkspace(card.workspaceId, …)`. El repositorio de
actividad tiene scope de workspace y se negaría a leer o escribir fuera de uno, y un job
no se ejecuta en ninguno. El payload dice el workspace; `runInWorkspace` entra en él sin
comprobar a nadie, tal como lo hizo el capítulo [4](./04-who-and-where) para los workers
y scripts que ya lo saben.

Quién lo hizo también sale del payload, `by` y `via`, por lo que el capítulo
[10](./10-events) los puso ahí.

### Los tipos del payload

El módulo importa las clases de los eventos de tarjeta con `import type`, solo por los
tipos de sus payloads, y `CardAuthor` y `CardDTO` del esquema de la tarjeta. Un módulo
puede llegar a los eventos y al esquema de otro (`newt/module-boundaries` lo permite);
nunca llega a su repositorio ni a su entidad.

### Leer

`listForCard` es una página normal (capítulo [3](./03-pages-and-errors)), de la más
nueva a la más antigua. Lee solo por el id de la tarjeta, nunca a través del módulo de
tarjetas: la tarjeta puede estar borrada, y su historial se queda.

## Suscribirse: `handler`

Cada evento de tarjeta recibe su handler, junto a la línea de log del capítulo
[10](./10-events). El `activity.workers.ts` entero:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.workers.ts
import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'
import type { Activity_Options } from './activity-options'

/**
 * What the activity does when something happens to a card: each event a `handler`,
 * a job saved with the change, so no entry is ever missing, run until it succeeds
 * and safe to run again (keyed on the event's id).
 */
export function registerActivityWorkers(activity: Activity_Module, deps: Activity_Deps, options: Activity_Options): void {
  const { events } = deps.card
  events.created.subscribe((card, event) => activity.recordCreated(card, event), { strategy: 'handler', queue: 'activity.recordCreated.on.card.created' })
  events.edited.subscribe((edit, event) => activity.recordEdited(edit, event), { strategy: 'handler', queue: 'activity.recordEdited.on.card.edited' })
  events.moved.subscribe((move, event) => activity.recordMoved(move, event), { strategy: 'handler', queue: 'activity.recordMoved.on.card.moved' })
  events.assigned.subscribe((assignment, event) => activity.recordAssigned(assignment, event), { strategy: 'handler', queue: 'activity.recordAssigned.on.card.assigned' })
  events.unassigned.subscribe((unassignment, event) => activity.recordUnassigned(unassignment, event), { strategy: 'handler', queue: 'activity.recordUnassigned.on.card.unassigned' })
  events.deleted.subscribe((card, event) => activity.recordDeleted(card, event), { strategy: 'handler', queue: 'activity.recordDeleted.on.card.deleted' })

  // A line in the server's log as each card moves, to watch a board live while
  // tracing. `fire-and-forget`: in memory, after the commit, with no job. If it fails,
  // or the server stops before it runs, the line is lost, and nothing is wrong: no
  // one needs it later, and the log above keeps the move for good.
  events.moved.subscribe(({ dto, previous, by, via }) => {
    options.log(`[boards] #${dto.number} "${dto.title}" moved from column ${previous.columnId} to ${dto.columnId} by ${by ?? 'cooper'}${via ? ` (${via})` : ''}`)
  }, { strategy: 'fire-and-forget' })
}
```

El callback recibe ahora un segundo argumento, el `EventMeta`, y llama a un caso de uso
del módulo que reacciona con lo que necesita. No hace nada más: la lógica vive en el caso
de uso, donde se puede probar y trazar.

`strategy: 'handler'` recibe el nombre de la cola, `queue`, y no hace falta nada más. El
comentario del principio del archivo dice ahora lo que dan los handlers, y el de la
línea del log dice por qué perder una línea no importa: el log de arriba guarda el
movimiento para siempre.

### El nombre de la cola

Los jobs de cada handler esperan en su cola, y el nombre de la cola es como el worker
vuelve a encontrar el handler tras un reinicio: un job escrito ayer nombra su cola, y el
proceso de hoy ejecuta el handler que se suscribió con ese nombre. Por eso lo escribes
entero, siempre con la misma forma:

```text
<módulo que reacciona>.<caso de uso al que llama>.on.<módulo que cuenta>.<evento>

activity.recordMoved.on.card.moved
```

Leído en voz alta, dice lo que hace: "la actividad registra el movimiento con
`card.moved`". Dos reacciones del mismo módulo al mismo evento llaman a dos casos de uso,
así que son dos colas; un caso de uso que reacciona a dos eventos son también dos colas.

newt comprueba el final cuando se abre el contexto: una cola que no acaba con el evento
al que está suscrita lanza un error, y el contexto no arranca. Suscribe `events.deleted`
con `activity.recordDeleted.on.card.removed`, y todos los tests fallan con:

```text
A handler's queue is '<module>.<use case>.on.card.deleted': 'activity.recordDeleted.on.card.removed' is not
```

El lint comprueba el resto, antes de que se ejecute nada. **`newt/queue-name`** lee cada
`subscribe` en los archivos de un módulo: la cola empieza por el módulo del archivo en
que está, nombra el caso de uso al que llama su callback en ese módulo, y acaba con el
evento bajo el que está suscrita. Llama a la cola del movimiento
`activity.recordMove.on.card.moved` (una letra de menos), y `bun run lint` dice:

```text
error  This queue says the handler calls activity's 'recordMove', but its callback calls no 'recordMove' of activity: name the use case it calls  newt/queue-name
```

y para el evento equivocado:

```text
error  This queue ends with '.on.….deleted', the event it subscribes to  newt/queue-name
```

**Renombrar una cola** no es gratis. Sus jobs pendientes se quedan con el nombre
antiguo, que ya no sirve ningún handler. newt no deja que eso pase en silencio: el worker
anota las colas que sirve, y avisa una vez de una cola con jobs esperando que ningún
worker ha servido en cinco minutos. Renombra un handler, su caso de uso o su módulo
cuando su cola esté vacía, o mueve sus jobs pendientes con una migración.

## La ruta

La actividad de una tarjeta se lee bajo el workspace, como todo en boards:
`GET /workspaces/:workspaceId/cards/:cardId/activity`. Sus rutas necesitan el módulo de
miembros, como las de cualquier módulo. Añádelo a las deps:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.deps.ts
import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
  /** That who reads a card's activity belongs to its workspace (its routes). */
  member: Member_Module
}
```

```ts
// cooper/backend/contexts/boards/modules/activity/activity.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'

export function registerActivityRoutes(base: BoardsBase, activity: Activity_Module, deps: Activity_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/cards/:cardId/activity', async request =>
    Response.json(await activity.listForCard(request.params.cardId, pageRequestFrom(request))))
}
```

y pásalo en `initialize-modules.ts`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
  const activity = Activity_Module.initialize(base, { card, member }, { log: deps.log ?? (() => {}) })
```

## Esperar al worker en un test

Un job se ejecuta tras la confirmación, en el tiempo del worker. Un test que crea una
tarjeta y lee su actividad enseguida no leería nada. Debe esperar a que el worker acabe.

`base.jobs.idle()` se resuelve cuando no hay ningún job listo ni en ejecución: ejecuta lo
que toca, espera a lo que está en curso, y lo repite hasta que no queda nada. Da al
helper de tests un método para ello, `settled`, después de `as`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
    /** Until the background work is done: what boards' events made it do. */
    async settled(): Promise<void> {
      await boards.base.jobs.idle()
    },
```

Un test llama a `await t.settled()` después de hacer cosas y antes de mirar lo que
hicieron sus reacciones. Un job que espera para ejecutarse más tarde (el backoff del
capítulo siguiente) no toca todavía, y `idle` no lo espera.

## Tests

Añade tres tests a `activity.test.ts`, antes del del capítulo [10](./10-events), con un
helper que lee la actividad de una tarjeta:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
  const inAcme = <T>(fn: () => Promise<T>, via: 'web' | 'mcp' = 'web') => t.as('ana', 'acme', fn, via)
  const activityOf = (cardId: string, size = 20) => inAcme(() => t.modules.activity.listForCard(cardId, { size }))

  test('records what happens to a card, who did it and how they came in, the newest first', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await inAcme(() => t.modules.card.edit(card.id, { title: 'Plan it' }))
    await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')
    await inAcme(() => t.modules.card.assign(card.id, { assigneeId: 'bea' }))
    await inAcme(() => t.modules.card.unassign(card.id))
    await inAcme(() => t.modules.card.delete(card.id))
    await t.settled()

    const { items, total } = await activityOf(card.id)
    expect(total).toBe(6)
    expect(items.map(entry => [entry.kind, entry.actorId, entry.via])).toEqual([
      ['deleted', 'ana', 'web'],
      ['unassigned', 'ana', 'web'],
      ['assigned', 'ana', 'web'],
      ['moved', 'ana', 'mcp'],
      ['edited', 'ana', 'web'],
      ['created', 'ana', 'web'],
    ])
    expect(items.find(entry => entry.kind === 'moved')!.detail).toEqual({ fromColumnId: todo, toColumnId: doing })
    expect(items.find(entry => entry.kind === 'edited')!.detail).toMatchObject({ changed: 'title', title: 'Plan it' })
    expect(items.find(entry => entry.kind === 'assigned')!.detail).toEqual({ assigneeId: 'bea', previousAssigneeId: null })

    // Page after page, by the cursor.
    const first = await activityOf(card.id, 4)
    const rest = await inAcme(() => t.modules.activity.listForCard(card.id, { size: 4, cursor: first.items.at(-1)!.id }))
    expect([...first.items, ...rest.items].map(entry => entry.kind)).toEqual(items.map(entry => entry.kind))
    expect(rest.hasMore).toBe(false)
  })

  test('records each event once, however many times its job runs', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await t.settled()
    const told = { ...card, by: 'ana', via: 'web' as const }
    const event = { id: Bun.randomUUIDv7(), name: 'card.created', occurredAt: new Date().toISOString() }

    await t.modules.activity.recordCreated(told, event)
    await t.modules.activity.recordCreated(told, event)

    expect((await activityOf(card.id)).total).toBe(2)
  })

  test('shows a workspace\'s activity only in it', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await t.settled()

    expect((await t.as('carl', 'globex', () => t.modules.activity.listForCard(card.id, { size: 20 }))).total).toBe(0)
  })
```

- El primero hace todo por lo que pasa una tarjeta, espera al worker, y lee las seis
  entradas, de la más nueva a la más antigua, también por páginas. La tarjeta ya está
  borrada entonces: su historial se queda.
- El segundo es un job que se ejecuta dos veces. Llama a `recordCreated` dos veces con el
  mismo evento, como haría el worker en una segunda ejecución, y la tarjeta tiene dos
  entradas: el `card.created` que registró el worker, y el de este evento, una vez.
  Llamar directamente al caso de uso, fuera de cualquier actor y de cualquier workspace,
  es como lo llama un worker.
- El tercero lee la actividad de la tarjeta desde globex, y no encuentra ninguna: el scope
  del repositorio.

El primer test también muestra `settled()` en acción: sin él, el test leería la
actividad mientras el worker aún puede estar escribiéndola.

## Compruébalo

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

Luego, a mano. Arranca el backend (`bun cooper/backend/index.ts`): ejecuta la migración
00005 al abrirse. Crea una tarjeta y muévela, como en el capítulo [10](./10-events), y
lee después su actividad:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
post() { curl -s -X POST "$API$1" -H "$H" -H 'x-user: ana' -d "$2"; }
BOARD=$(post /boards "{\"name\":\"History $RANDOM\"}" | jq -r .id)
TODO=$(post /boards/$BOARD/columns '{"name":"To do"}' | jq -r .id)
DOING=$(post /boards/$BOARD/columns '{"name":"Doing"}' | jq -r .id)
CARD=$(post /boards/$BOARD/cards "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" | jq -r .id)
post /cards/$CARD/move "{\"columnId\":\"$DOING\"}" > /dev/null
curl -s $API/cards/$CARD/activity -H 'x-user: ana' | jq -c '.items[] | {kind, actorId, via, detail}'
```

```text
{"kind":"moved","actorId":"ana","via":"web","detail":{"fromColumnId":"01a17957-8995-71de-978e-f65c646f7700","toColumnId":"01a17957-899d-741b-b50a-c2dafd47c482"}}
{"kind":"created","actorId":"ana","via":"web","detail":{"number":1,"title":"Plan","columnId":"01a17957-8995-71de-978e-f65c646f7700"}}
```

La consola sigue mostrando la línea del movimiento, como antes. Y el outbox guarda los
jobs que escribieron las entradas. Míralos en la base de datos:

```sh
sqlite3 data/cooper-boards.db "SELECT queue, status, attempts FROM job ORDER BY created_at, queue"
```

```text
activity.recordCreated.on.card.created|done|1
activity.recordMoved.on.card.moved|done|1
```

Cada uno hecho en su primer intento, uno por evento. (Las tarjetas cambiadas antes de este
capítulo no dejaron jobs: entonces nada se suscribía como handler. Las que cambies ahora
añaden los suyos.) Los jobs hechos son historia: newt los purga pasada una semana.

## En resumen

- `strategy: 'handler'` escribe un job en el outbox, en la transacción del cambio que
  cuenta el evento: se guardan los dos o ninguno. El worker del contexto lo ejecuta tras
  la confirmación, y otra vez hasta que tiene éxito.
- Su `queue` es `<módulo>.<caso de uso>.on.<módulo>.<evento>`. newt rechaza una que no
  acabe con su evento; `newt/queue-name` comprueba el resto. Renombrarla deja atrás sus
  jobs pendientes.
- Un job se ejecuta al menos una vez, así que quizá más: lo que hace debe ser idempotente.
  El segundo argumento del handler, `EventMeta`, da el `id` del evento, el mismo en cada
  ejecución: usa ese id como clave.
- Un job se ejecuta sin actor y sin scope: lee quién lo hizo del payload, y entra él
  mismo en el workspace (`runInWorkspace`).
- Un test espera al worker con `base.jobs.idle()` antes de mirar lo que hicieron las
  reacciones.

Siguiente: [Lo que no se puede deshacer, y los fallos](./12-failures).
