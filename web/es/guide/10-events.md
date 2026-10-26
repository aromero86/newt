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
import type { CardDTO } from '../card.schema'

/** The card, now assigned to `dto.assigneeId`, and who had it before, if anyone. */
type CardAssignment = { dto: CardDTO, previousAssigneeId: string | null }

export class Card_Assigned implements DomainEvent<CardAssignment> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardAssignment) {}
}
```

El nombre es `<módulo>.<qué pasó>`. El payload son datos planos (DTOs, textos,
números), nunca una entidad: se escribe en la base de datos y se lee más tarde, quizá
con otra versión del código.

## Lo cuenta la entidad

Lo viste en [tu primer módulo](./03-first-module): la entidad apunta sus eventos con
`trackEvent`, dentro del método que hace el cambio. Nadie más lo hace.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
/** To a member of its workspace: the module checked they are. Assigning it again to the same one changes nothing. */
assign(assigneeId: string): void {
  const previousAssigneeId = this.data.assigneeId
  if (assigneeId === previousAssigneeId) return
  this.change({ assigneeId })
  this.trackEvent(new Card_Assigned({ dto: this.toDTO(), previousAssigneeId }))
}

unassign(): void {
  const previousAssigneeId = this.data.assigneeId
  if (previousAssigneeId === null) return
  this.change({ assigneeId: null })
  this.trackEvent(new Card_Unassigned({ dto: this.toDTO(), previousAssigneeId }))
}
```

Fíjate en los `return` del principio. Asignar una tarjeta a quien ya la tiene no
cambia nada, así que no cuenta nada. Quien escucha nunca recibe un evento de un cambio
que no ocurrió.

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
static create(input: CardOpening): Card {
  const card = new Card(input, true)
  card.trackEvent(new Card_Created(card.toDTO()))
  return card
}

// …
place(number: number, position: number): void {
  if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
  this.change({ number, position })
  this.trackEvent(new Card_Created(this.toDTO()))
}
```

El guardado publica un `card.created`, no dos, porque:

> Una entidad cuenta, como mucho, un evento de cada clase (de cada nombre) por
> guardado. Uno nuevo de la misma clase sustituye al anterior.

El último se construye con la entidad tal como está ahora, así que lo cuenta todo:
aquí, la tarjeta con su número de verdad. Esta es la regla entera, en la `Entity` de
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
edit(changes: { title?: string, description?: string }): void {
  this.change(changes)
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Card_Edited({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
}

/** Someone moved it: to this column, at this position. */
moveTo(columnId: string, position: number): void {
  this.change({ columnId, position })
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Card_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
}
```

- `dto`: la tarjeta como queda, entera.
- `changes`: los campos que cambiaron desde que se cargó.
- `previous`: lo que valían antes.

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
se suscribe a `card.events.assigned` recibe un `{ dto, previousAssigneeId }`.

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
- Un módulo ofrece sus eventos con `eventsOf`, bajo `events`. En cuanto alguien los
  escucha, son un contrato.
