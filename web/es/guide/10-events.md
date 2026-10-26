# Eventos: contar lo que pasó

Hasta ahora cada caso de uso hacía su trabajo y respondía. Pero hay cambios que le
importan a alguien más. Cuando se asigna una tarjeta, la persona asignada debería
enterarse. Cuando auth borra un workspace, boards tiene que borrar sus tableros. El
módulo de tarjetas no debería saber nada de emails, y auth no debería saber que boards
existe.

newt lo resuelve con eventos. Un módulo cuenta lo que pasó, y quien tenga interés lo
escucha. Este capítulo va de contar. El siguiente, de escuchar.

## Qué es un evento

Un evento es algo que ya ha pasado, nombrado en pasado: `card.assigned`,
`tenant.created`, `access.revoked`. El módulo que lo cuenta no sabe quién lo escucha,
ni si lo escucha alguien.

En cooper cada evento es una clase pequeña en la carpeta `events` de su módulo. Tiene
un nombre, el momento en que ocurrió y un payload:

```ts
// cooper/backend/contexts/boards/modules/card/events/card-assigned.ts
import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/** The card, now assigned to `dto.assigneeId`, who had it before, if anyone, and who assigned it. */
type CardAssignment = { dto: CardDTO, previousAssigneeId: string | null } & CardAuthor & { by: string }

export class Card_Assigned implements DomainEvent<CardAssignment & CardEventStamp> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardAssignment & CardEventStamp
  constructor(assignment: CardAssignment) {
    this.payload = { ...assignment, ...cardEventStamp() }
  }
}
```

El nombre es `<módulo>.<qué pasó>`. El payload son datos planos (DTOs, textos,
números), nunca una entidad: se escribe en la base de datos y se lee más tarde, quizá
con otra versión del código.

## Lo que lleva cualquier evento de una tarjeta

Fíjate en lo que lleva el payload de una tarjeta además de la tarjeta. Dos cosas, las
mismas en sus seis eventos.

Quién lo hizo. `by` es el id del usuario y `via` cómo entró: por la web, o con un
asistente de IA a través del [servidor MCP](./21-mcp-server). Los dos son `null` cuando
lo hizo boards por su cuenta, desde un worker, sin nadie detrás:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
/**
 * Who does something to a card, as its events tell it: their user's id (`by`) and how
 * they came in (`via`, the web or MCP). Both null for boards' own work, which a worker
 * does with no one behind it (ch. 13.5): a workspace's welcome card, the cards a
 * removed column or a member who left leaves behind.
 */
export type CardAuthor = { by: string | null, via: ActorVia | null }
```

Detrás de una asignación siempre hay alguien, así que `Card_Assigned` lo estrecha a
`{ by: string }`.

El id y la hora del propio evento. Quien escucha solo ve el payload, nunca el objeto
evento que lo envuelve, así que lo que necesite saber del evento en sí tiene que ir
dentro:

```ts
// cooper/backend/contexts/boards/modules/card/events/card-event-stamp.ts
/**
 * What every event of a card carries besides what happened: its own id and when it
 * was told. A handler sees only the payload, so whoever reacts once per event (the
 * activity log) keys on this id.
 */
export type CardEventStamp = { eventId: string, at: string }

export function cardEventStamp(): CardEventStamp {
  return { eventId: Bun.randomUUIDv7(), at: new Date().toISOString() }
}
```

Por qué el autor va en el evento y no se lee después: un worker que reacciona corre
[sin actor](./11-reacting#un-worker-llama-a-un-caso-de-uso). Quién movió la tarjeta
solo se sabe ahora, mientras corre el caso de uso. Si quien escucha lo va a necesitar,
lo tiene que llevar el evento. El `eventId` es lo que le permite a quien escucha
[hacer su trabajo una sola vez](./13-repeatable-workers), corra su job las veces que
corra.

## Lo cuenta la entidad

Lo viste en [tu primer módulo](./03-first-module): la entidad apunta sus eventos con
`trackEvent`, dentro del método que hace el cambio. Nadie más lo hace.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
/** To a member of its workspace, by someone: the module checked they are. Assigning it again to the same one changes nothing. */
assign(assigneeId: string, author: CardAuthor & { by: string }): void {
  const previousAssigneeId = this.data.assigneeId
  if (assigneeId === previousAssigneeId) return
  this.change({ assigneeId })
  this.trackEvent(new Card_Assigned({ dto: this.toDTO(), previousAssigneeId, ...author }))
}

unassign(author: CardAuthor): void {
  const previousAssigneeId = this.data.assigneeId
  if (previousAssigneeId === null) return
  this.change({ assigneeId: null })
  this.trackEvent(new Card_Unassigned({ dto: this.toDTO(), previousAssigneeId, ...author }))
}
```

Fíjate en los `return` del principio. Asignar una tarjeta a quien ya la tiene no
cambia nada, así que no cuenta nada. Quien escucha nunca recibe un evento de un cambio
que no ocurrió.

La entidad no sabe quién actúa: se lo dice el módulo. Un caso de uso al que llama una
ruta o una herramienta MCP le pasa la persona que actúa ahora; uno al que llama un
worker le pasa `BOARDS`, nadie:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** Boards' own work, from a worker: no one did it. */
const BOARDS: CardAuthor = { by: null, via: null }

/** The person acting now, as a card's events tell it: a use case a route or an MCP tool called. */
function actingAuthor(): CardAuthor & { by: string } {
  const { userId, via } = currentActor()
  return { by: userId, via }
}

// …
@UseCase()
async assign(id: string, input: CardAssignDTO): Promise<CardDTO> {
  const { assigneeId } = CardAssignSchema.parse(input)
  const card = await this.load(id)
  await this.assertMember(assigneeId)
  card.assign(assigneeId, actingAuthor())
  await this.repo.persist(card)
  return card.toDTO()
}
```

`via` no es un campo de newt. El actor de newt sabe una cosa, su usuario; cooper añade
cómo entró, una vez, para todos sus programas:

```ts
// cooper/backend/shared/actor.ts
export type ActorVia = 'web' | 'mcp'

// …
declare module 'newt/core' {
  interface Actor {
    via: ActorVia
  }
}
```

## Cuándo se publica

Apuntar un evento no es publicarlo. El repositorio publica los eventos de la entidad
al guardarla, dentro de la transacción del guardado. Este es el `save` de newt, en el
que acaba cualquier método de un repositorio:

```ts
// packages/newt/repository/repository.ts
protected async save<T extends E>(entities: T[], write: (entity: T) => void | Promise<void>, hooks: SaveHooks = {}): Promise<void> {
  // …
  await this.store.transaction(async () => {
    // …
    for (const entity of changed) {
      await write(entity)
      entity[markPersisted]()
    }
    await hooks.after?.()
    for (const entity of entities) {
      const events = entity[takeEvents]()
      // One that ends as it was read has nothing to tell: a change undone is no change.
      if (!changed.has(entity)) continue
      for (const event of events) await this.base.publisher.publish(event)
    }
  })
}
```

Y esto es lo que hace publicar, en la `Base` del contexto:

```ts
// packages/newt/runtime/base.ts
this.publisher = {
  publish: async event => {
    await this.jobs.enqueue(event)
    this.store.afterCommit(() => {
      memory.publish(event)
      this.jobs.wake()
    })
  },
}
```

Pasan dos cosas. Las reacciones duraderas al evento se escriben como jobs, en la misma
transacción que el cambio (de ellas va el capítulo siguiente). Todo lo demás espera
al commit. Así que:

> Un evento se publica cuando la transacción que lo guardó se confirma. Si la
> transacción se deshace, el evento no existió nunca.

Nadie reacciona jamás a una asignación que no llegó a guardarse.

## Un evento de cada clase por guardado

Una tarjeta se crea en dos pasos. `Card.create` la construye con el número y la
posición que parecía que le tocaban, y apunta `card.created`. Después el repositorio
le da el número y la posición que le tocan de verdad, dentro del guardado (mira
[valores que todos cambian](./09-shared-counters)), y `place` vuelve a apuntar
`card.created`:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
static create(input: CardOpening, author: CardAuthor): Card {
  const card = new Card(input, true)
  card.author = author
  card.trackEvent(new Card_Created({ ...card.toDTO(), ...author }))
  return card
}

// …
place(number: number, position: number): void {
  if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
  this.change({ number, position })
  this.trackEvent(new Card_Created({ ...this.toDTO(), ...this.author! }))
}
```

El guardado publica un `card.created`, no dos, porque:

> Una entidad cuenta, como mucho, un evento de cada clase (de cada nombre) por
> guardado. Uno nuevo de la misma clase sustituye al anterior.

El último se construye con la entidad tal como está ahora, así que lo cuenta todo:
aquí, la tarjeta con su número de verdad, y un `eventId` nuevo. Esta es la regla entera, en la `Entity` de
newt:

```ts
// packages/newt/core/entity/entity.ts
protected trackEvent(event: DomainEvent): void {
  this.domainEvents = [...this.domainEvents.filter(each => each.name !== event.name), event]
}
```

Dos clases distintas en un mismo guardado se pueden, pero suelen ser señal de que el
caso de uso hace dos cosas. En cooper cada caso de uso lleva una entidad de un estado
al siguiente y lo cuenta una vez.

## Qué cuenta un cambio: el antes y el después

Un evento `created` lleva la entidad entera, como DTO. Un evento sobre un cambio lleva
más, porque a quien lo escucha casi siempre le importa qué cambió. Mira `edit` y
`moveTo`:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
edit(changes: { title?: string, description?: string }, author: CardAuthor): void {
  this.change(changes)
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Card_Edited({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()!, ...author }))
}

/** Someone moved it, or boards did (its column was removed): to this column, at this position. */
moveTo(columnId: string, position: number, author: CardAuthor): void {
  this.change({ columnId, position })
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Card_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()!, ...author }))
}
```

- `dto`: la tarjeta como queda, entera.
- `changes`: los campos que cambiaron desde que se cargó.
- `previous`: lo que valían antes.
- `by` y `via`, `eventId` y `at`, como cualquier evento de una tarjeta.

Quien guarde un historial de movimientos puede escribir "de Doing a Done" sin leer
nada más. Y otra vez el `if (diff)`: guardar el mismo título no cuenta nada.

`card.assigned` hace lo mismo con menos campos: la tarjeta y `previousAssigneeId`.
Dale a cada payload la forma de lo que quien escucha necesita saber.

No todo cambio merece un evento. Cuando una tarjeta se mueve, las de alrededor ocupan
los huecos (`reposition`), y no cuentan nada: nadie las movió.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
/** Another one moved, or left: this one takes the place left to it in its column, and tells nothing. */
reposition(position: number): void {
  this.change({ position })
}
```

## Ofrecer los eventos: `events`

Cada módulo ofrece sus eventos bajo `events`, construidos con `eventsOf` a partir de
las clases de sus eventos. Ahí es donde se suscriben los demás:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
readonly events

private constructor(
  base: BoardsBase,
  private readonly repo: Card_Repository,
  private readonly deps: Card_Deps,
  private readonly options: Card_Options,
) {
  super('card', base.invocations)
  this.events = eventsOf(base.bus, {
    created: Card_Created,
    edited: Card_Edited,
    moved: Card_Moved,
    assigned: Card_Assigned,
    unassigned: Card_Unassigned,
    deleted: Card_Deleted,
  })
}
```

Desde fuera se leen como lo que son: `card.events.assigned`. Y vienen tipados: quien
se suscribe a `card.events.assigned` recibe un
`{ dto, previousAssigneeId, by, via, eventId, at }`.

auth hace lo mismo, y sus eventos son los que escuchan los otros contextos:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
this.events = eventsOf(base.bus, { created: Tenant_Created, renamed: Tenant_Renamed, deleted: Tenant_Deleted })
```

En cuanto otro módulo, u otro contexto, escucha un evento, su nombre y su payload son
un contrato. [Cuando algo falla](./15-failures) explica por qué su forma solo puede
crecer.

## Compruébalo

Un test puede escuchar un evento de la forma más sencilla (las opciones las ves en el
capítulo siguiente) y contar lo que oye. Este test de auth borra un workspace con dos
miembros y comprueba que se contó un `access.revoked` por cada uno:

```ts
// cooper/backend/contexts/auth/auth.test.ts
const told: string[] = []
modules().access.events.revoked.subscribe(access => { told.push(access.userId) }, { strategy: 'fire-and-forget' })

// …
await as(ana, () => modules().tenant.delete(acme.id))
// …
await settled()

// …
expect(told.sort()).toEqual([ana.id, bob.id].sort())
```

Y los tests de tarjetas comprueban el otro lado: asignar otra vez una tarjeta a la
misma persona no cuenta nada, así que no sale un segundo email.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
// Assigning it again to the same one changes nothing, and tells nothing.
await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
await t.settled()
expect(t.mails).toHaveLength(1)
```

## En resumen

- Un evento es algo que ya ha pasado, en pasado: `<módulo>.<qué pasó>`. Su payload
  son datos planos.
- Lo apunta la entidad con `trackEvent`, en el método que hace el cambio. Sin cambio,
  no hay evento.
- El repositorio lo publica con el guardado: solo existe si la transacción se confirma.
- Como mucho un evento de cada clase por guardado: el último sustituye a los demás.
- Un evento de cambio lleva `dto`, `changes` y `previous`.
- Lo que quien escucha va a necesitar y solo sabe el momento va en el payload: quién
  actuó (`by`, `via`), y el id y la hora del propio evento.
- Un módulo ofrece sus eventos con `eventsOf`, bajo `events`. En cuanto alguien los
  escucha, son un contrato.
