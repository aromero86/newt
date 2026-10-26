# Reaccionar a un evento

El módulo de tarjetas cuenta `card.assigned`. Ahora alguien tiene que escribirle un
email a la persona asignada. Este capítulo muestra cómo reacciona un módulo a un
evento: las dos formas de suscribirse, el job que newt guarda con el cambio, el nombre
de su cola y el worker que llama a un caso de uso.

## Siempre igual: suscribirse

Un módulo reacciona a un evento, suyo o de otro módulo, suscribiéndose a él:

```ts
<módulo>.events.<evento>.subscribe(callback, opciones)
```

Las opciones dicen la estrategia. No hay valor por defecto: eliges cada vez, a
propósito.

| | `'fire-and-forget'` | `'handler'` |
|---|---|---|
| Cuándo se ejecuta | Justo después del commit. | Justo después del commit. |
| Si falla | Se pierde. | Se vuelve a ejecutar más tarde, esperando más cada vez. |
| Si el servidor se para antes | Se pierde. | Se ejecuta cuando vuelve. |
| Dónde vive | En memoria. | Un job, guardado en el store. |
| Para qué | Lo que puedes perder: limpiar una caché, una métrica. | Todo lo que importa: un email, un cambio en otro módulo. |

`'fire-and-forget'` es tan sencilla como suena. El código de cooper no la usa nunca;
sus tests sí, para contar eventos (lo viste en el [capítulo anterior](./10-events)):

```ts
// cooper/backend/contexts/auth/auth.test.ts
modules().access.events.revoked.subscribe(access => { told.push(access.userId) }, { strategy: 'fire-and-forget' })
```

`'handler'` es la que usarás casi siempre. Si dudas, úsala: casi todo lo que hace un
backend importa.

Cada estrategia tiene sus propias opciones, y TypeScript solo te deja escribir esas:
`'fire-and-forget'` no lleva nada más; `'handler'` lleva su `queue` y, si hace falta,
`attempts`.

## Las reacciones de un módulo: `<módulo>.workers.ts`

Las reacciones de un módulo viven en su `<módulo>.workers.ts`, una función a la que
llama su `initialize`. Estas son las del módulo de tarjetas:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them.
  cards.events.created.subscribe(async card => {
    if (card.assigneeId !== null) await cards.notifyAssignee(card)
  }, {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
  })
  cards.events.assigned.subscribe(({ dto }) => cards.notifyAssignee(dto), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.assigned',
  })

  // A card points at its column: when a column goes, no card is left in it.
  deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.column.removed',
  })

  // auth took someone's access to a workspace: their cards there are left unassigned.
  // auth tells every access it takes away, to any product: only a workspace's is boards'.
  deps.access.revoked.subscribe(async access => {
    if (access.productId === WORKSPACES_PRODUCT && access.tenantId !== null) await cards.unassignMember(access.tenantId, access.userId)
  }, {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
  })
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
static initialize(base: BoardsBase, deps: Card_Deps, options: Card_Options): Card_Module {
  const module = new Card_Module(base, new Card_Repository(base), deps, options)
  registerCardRoutes(base, module, deps)
  registerCardWorkers(module, deps)
  return module
}
```

Léelo en voz alta: "cuando se asigna una tarjeta, el módulo de tarjetas avisa a la
persona asignada"; "cuando se quita una columna, las tarjetas salen de ella"; "cuando
auth retira un acceso, las tarjetas se quedan sin ese miembro". Cuatro reacciones,
tres orígenes: los eventos del propio módulo, los de otro módulo (`column`) y los de
otro contexto (`access`, en auth).

- El callback recibe el payload del evento y llama a un caso de uso del módulo que
  reacciona, con lo que ese caso de uso necesita: aquí `dto`, no el payload entero.
- El callback puede decidir si el evento le concierne. Una tarjeta creada sin nadie
  asignado no necesita email. auth retira accesos a todos sus productos, y aquí solo
  importa el de un workspace. Es una condición sobre el evento, nunca lógica de
  negocio: esa va en el caso de uso.

El módulo de tarjetas no recibe `access` como el módulo de auth. Recibe un puerto con
sus propias palabras, que solo dice que se puede suscribir a él:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
export type AccessEvents = {
  /**
   * Someone lost their access to a product of auth's: to a workspace of `cooper`
   * (`tenantId`), or to a product with none (null, the backoffice's staff).
   */
  revoked: Pick<DomainEventEmitter<{ userId: string, productId: string, tenantId: string | null }>, 'subscribe'>
}
```

El `access.events` de auth encaja en él, y un test pasa el suyo. [Varios
contextos](./19-several-contexts) vuelve sobre esto.

## Un job, guardado con el cambio

Cada reacción `'handler'` es un job. newt lo escribe en la misma transacción que el
cambio que cuenta el evento: viste `this.jobs.enqueue(event)` dentro de `publish` en
el capítulo anterior. Esto es todo:

```ts
// packages/newt/runtime/jobs/job-queue.ts
/** One job for each handler the event concerns, in the transaction of the save that publishes it. */
async enqueue(event: DomainEvent): Promise<void> {
  const now = new Date().toISOString()
  const jobs: Job[] = [...this.registrations]
    .filter(([, registration]) => eventNameMatches(registration.pattern, event.name))
    .map(([queue]) => ({ id: Bun.randomUUIDv7(), queue, event: JSON.stringify(event), status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now }))
  if (jobs.length > 0) await this.store.add(jobs)
}
```

Así que la asignación y el job "avisar a la persona asignada" se guardan juntos, o
ninguno de los dos. La tabla donde van es el outbox: una tabla de jobs en el mismo
store que los datos. Tras el commit, el worker se despierta, reclama el job y ejecuta
el callback:

```text
una transacción                         después del commit
┌─────────────────────────────────┐
│ card: assigneeId = bea          │ ──▶ el worker reclama el job
│ job: card.notifyAssignee.on.    │     y ejecuta card.notifyAssignee(dto)
│      card.assigned (pending)    │     ¿falla? se repite más tarde
└─────────────────────────────────┘
```

El job guarda el evento como JSON, tal como se publicó. Eso importa para [lo que
pones en un payload](./14-irreversible).

### Qué worker lo ejecuta

El job va al outbox del contexto cuyo emisor escuchas. boards se suscribe a
`tenant.created` y `access.revoked` en los emisores de auth, así que esos jobs se
guardan en la base de datos de auth, con el cambio de auth, y los ejecuta el worker
de auth. cooper lo dice donde conecta los dos:

```ts
// cooper/backend/open-contexts.ts
/**
 * What `boards` asks of auth, wired to auth's use cases and events. A workspace is a
 * tenant of the product `cooper`, and its members are those with access to it.
 * boards' reactions to auth's events are subscribed on auth's emitters: they are jobs
 * of auth's outbox, run by auth's worker (`auth.base.jobs.idle()`, then boards').
 */
```

Eso es lo que hace segura una reacción entre contextos: el workspace y el job que le
da su tablero están en la misma transacción, en el store de auth. Un job en el store
de boards no podría estarlo.

## El nombre de su cola

Los jobs de cada reacción esperan en una cola, y la cola tiene un nombre que la
encuentra otra vez tras un reinicio. Lo escribes tú, entero, siempre con la misma
forma: el módulo que reacciona, su caso de uso y el evento.

```text
<módulo que reacciona>.<caso de uso>.on.<evento>

card.notifyAssignee.on.card.assigned
card.unassignMember.on.access.revoked
workspace.prepare.on.tenant.created
```

Leído en voz alta, dice lo que hace. Un evento puede tener varias reacciones en un
módulo (dos casos de uso), y cada una tiene su cola:
`card.notifyAssignee.on.card.created` y `card.notifyAssignee.on.card.assigned` son
dos colas del mismo caso de uso.

newt comprueba la forma al suscribirte. Si la cola no termina en el evento al que te
suscribes, el contexto falla al abrirse, no en producción a medianoche:

```ts
// packages/newt/core/events/domain-event-emitter.ts
const { queue, attempts } = subscription
if (!QUEUE.test(queue) || !queue.endsWith(`.on.${this.name}`)) {
  throw new Error(`A handler's queue is '<module>.<use case>.on.${this.name}': '${queue}' is not`)
}
```

Hay una consecuencia. Renombrar una cola (porque renombraste el caso de uso o el
módulo) deja sus jobs pendientes con el nombre viejo, que no atiende ningún worker.
newt no deja que pase en silencio: el worker lo comprueba al arrancar y después cada
minuto, y avisa una vez de cada cola con jobs que ningún worker ha atendido en cinco
minutos:

```ts
// packages/newt/runtime/jobs/job-queue.ts
console.warn(`[JobQueue] ${jobs} job(s) of '${queue}' wait, and no worker serves that queue: was its handler renamed or removed?`)
```

Si renombras una, hazlo cuando su cola esté vacía, o mueve sus jobs pendientes con
una migración.

## Un worker llama a un caso de uso

Un worker nunca escribe por su cuenta: llama a un caso de uso de su módulo. La lógica
vive en un solo sitio, y el caso de uso se puede probar, trazar y llamar desde donde
haga falta. El callback no hace nada más.

Este es el caso de uso que hay detrás de `card.assigned`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Tells the assignee of a card they have it, by email: from a worker, once the
 * assignment is saved, since an email cannot be taken back (ch. 16). Run late, it
 * reads the card again: if it is gone, or has another assignee by then, there is
 * nothing to tell (that assignment tells its own).
 */
@UseCase()
async notifyAssignee(card: CardDTO): Promise<void> {
  if (card.assigneeId === null) return
  const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
  if (current?.assigneeId !== card.assigneeId) return
  const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
  if (!member) return
  const link = new URL(`/workspaces/${card.workspaceId}/boards/${card.boardId}?card=${card.number}`, this.options.publicUrl)
  await this.options.mailer.send({
    to: member.email,
    subject: `#${card.number} ${card.title} is yours`,
    text: [`Hi ${member.name},`, '', `Card #${card.number}, "${card.title}", is assigned to you.`, '', link.toString()].join('\n'),
  })
}
```

Un worker se ejecuta sin nada alrededor: sin actor y sin scope. Ni la persona que
asignó la tarjeta ni nadie más. newt ejecuta cada job desligado de quien hizo el
commit, arrancó el worker o lo espera:

```ts
// packages/newt/runtime/jobs/job-queue.ts
/**
 * No context at all: this module's, taken as it loads, before any request or script
 * enters a scope. Jobs run in it, never in that of whoever made the queue (a context
 * opened lazily, inside a request), started the worker or waits for it (`idle`), so
 * a handler has no actor nor scope but the ones it sets itself.
 */
const detached = AsyncLocalStorage.snapshot()
```

Así que el caso de uso pone él mismo lo que necesita, a partir del evento:

- El workspace: `runInWorkspace(card.workspaceId, …)` entra en el [scope del
  workspace](./05-who-and-where) sin comprobar a nadie, porque un worker ya lo sabe. El
  repositorio de tarjetas está acotado a un workspace y se negaría a leer fuera de uno.
- El miembro: `member.find(workspaceId, userId)` recibe el workspace como argumento,
  mientras que `member.isMember(userId)` lo lee del scope. Uno es para peticiones; el
  otro, para workers.
- `currentActor()` lanzaría aquí un error, y el job fallaría en cada intento hasta
  morir. Si un caso de uso necesita saber quién hizo algo, lo lee de los datos, o lo
  trae el evento.

El mailer es una opción del módulo, que le da el contexto: la consola en desarrollo,
una lista en los tests, un servicio de email en producción. El módulo no sabe cuál.

```ts
// cooper/backend/contexts/boards/modules/card/card-options.ts
/** What the context configures the cards with. */
export type Card_Options = {
  /** What tells an assignee: the console in development, a list in a test. */
  mailer: Mailer
  /** Where people open boards: the links of its emails start there. */
  publicUrl: string
}
```

## Compruébalo

El worker solo se ejecuta tras el commit, así que un test tiene que esperarlo.
`jobs.idle()` se resuelve cuando no queda ningún job listo ni en marcha. Los tests de
boards esperan primero al worker de auth (ahí se ejecutan las reacciones de boards a
auth) y después al de boards:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
/** Until the background work is done: auth's events heard, and what they made boards tell. */
async settled(): Promise<void> {
  await auth.idle()
  await boards.base.jobs.idle()
},
```

Después el test asigna una tarjeta, comprueba que aún no hay email, espera, y ve uno:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('assigns a card only to a member of its workspace, and tells them by email once saved', async () => {
  const plan = await create('Plan')

  await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })

  await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
  expect(t.mails).toEqual([])
  await t.settled()
  expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#1 Plan is yours']])
  expect(t.mails[0]!.text).toContain(`/workspaces/acme/boards/${boardId}?card=1`)
  // …
})
```

Ejecútalo con `bun test cooper/backend/contexts/boards/modules/card`. En desarrollo,
asigna una tarjeta en la aplicación y mira la consola del servidor: el email aparece
ahí un instante después.

## En resumen

- Un módulo reacciona suscribiéndose a un evento, siempre con una estrategia:
  `'fire-and-forget'` para lo que puedes perder, `'handler'` para todo lo demás.
- Las reacciones de un módulo viven en `<módulo>.workers.ts`, al que llama su
  `initialize`.
- Un `'handler'` es un job guardado en la misma transacción que el cambio, y lo
  ejecuta un worker tras el commit. Vive en el outbox del contexto dueño del evento.
- Su cola es `<módulo que reacciona>.<caso de uso>.on.<evento>`. Renómbrala solo
  cuando esté vacía.
- El callback solo decide si el evento le concierne y llama a un caso de uso.
- Un worker no tiene actor ni scope: el caso de uso pone lo que necesita a partir del
  evento.
