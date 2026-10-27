# Escuchar a otro contexto

Bea deja acme. Quien lleva acme le quita el acceso, y eso ocurre en auth, que guarda
quién pertenece a cada workspace. boards guarda las tarjetas, y algunas tarjetas de acme
siguen diciendo que son de Bea. Nadie va a trabajar en ellas ahora. Deberían volver a no
tener asignado.

auth y boards son dos contextos, cada uno con su base de datos (auth llega de verdad en
el capítulo 17; hasta entonces hace de auth uno falso). auth no debe meterse en boards
para desasignar las tarjetas: tendría que conocer boards, y escribiría en filas que no
son suyas. auth solo **cuenta** lo que pasó, `access.revoked`, y boards **escucha** y
hace su parte.

La misma forma arregla algo más cercano. El [capítulo 8](./08-two-people-one-card) dejó
un hueco en `removeColumn`: una tarjeta movida a una columna, o creada en ella, entre el
recuento y el borrado acaba en una columna que ya no existe. También eso es algo que pasó
(`column.removed`, que emite el módulo de columnas) y cuya consecuencia es de otro (las
tarjetas).

Las dos cosas tienen una vuelta de tuerca. Una reacción se ejecuta un momento después del
evento, y en ese momento el otro lado puede estar todavía de camino: una tarjeta puede
guardarse en una columna cuyo borrado ya se atendió, o darse a alguien cuya salida ya se
atendió. Este capítulo cierra también esa carrera, en los dos sentidos, y la forma de
hacerlo es la idea que hay que llevarse: **cada lado, una vez guardado, mira al otro**.

## Una tarjeta en una columna borrada

Recuerda el hueco. `card.removeColumn` cuenta las tarjetas de la columna y, si no hay
ninguna, hace que el módulo de columnas la borre. Entre el recuento y el borrado, Carla
mueve una tarjeta a esa columna. El recuento dijo cero, la columna se va, y la tarjeta de
Carla apunta a una columna que ninguna lista muestra. Su tarjeta se pierde del tablero.

No puedes cerrarlo contando mejor: el recuento y el borrado son guardados de dos
módulos, y el módulo de columnas no sabe nada de tarjetas. Así que dejas que el hueco
ocurra y lo limpias justo después. Borrar una columna emite `column.removed` (desde el
[capítulo 10](./10-events)), con la columna en su payload. El módulo de tarjetas escucha,
y lleva cualquier tarjeta que siga en esa columna a la primera del tablero. Un tablero
siempre tiene una: desde el [capítulo 8](./08-two-people-one-card), su última columna no
se borra.

### La carrera en el otro sentido

Eso cubre una tarjeta que estaba en la columna cuando se fue. No cubre el otro orden.
`card.move` comprueba la columna que recibe (`assertColumnOf` pide al módulo de columnas
las columnas del tablero), luego lee las tarjetas y guarda. Entre su comprobación y su
guardado, la columna puede borrarse, y su worker puede ejecutarse:

```text
Carla mueve la #4 a Done                    ana borra Done
────────────────────────                    ──────────────
comprueba que Done es columna del tablero
                                            cuenta las tarjetas de Done: 0
                                            borra Done, emite column.removed
                                            worker: ¿tarjetas en Done? ninguna
guarda la #4 en Done, emite card.moved
```

El worker de la columna se ejecutó y no encontró nada, porque la tarjeta aún no estaba.
Luego la tarjeta llegó a una columna que nadie volverá a mirar. Nada en el guardado de la
tarjeta ve irse la columna: la columna es una fila de otro módulo, y el movimiento protege
las tarjetas que reordena, no la columna.

No puedes hacer que el worker espere a un movimiento que quizá llegue. Lo que sí puedes
hacer es dar a la tarjeta una mirada propia. La tarjeta emite `card.moved` una vez
guardada; un worker sobre ese evento pregunta: ¿sigue ahí mi columna? Si ya no está, la
tarjeta va a la primera columna, como habría hecho el worker de la columna. Una tarjeta
creada en una columna tiene el mismo hueco (`newCard` también comprueba la columna, antes
de su guardado), así que `card.created` recibe la misma mirada.

Ahora hay dos seguidores, y cada uno se ejecuta **después de su propio guardado** y **mira
el estado del otro lado**:

- El worker de la columna se ejecuta después de guardarse el borrado, y mira las tarjetas.
- El worker de la tarjeta se ejecuta después de guardarse la tarjeta, y mira la columna.

El que de los dos se ejecute el último ve los dos guardados, y mueve la tarjeta. El que se
ejecuta primero puede no encontrar nada que hacer, y no pasa nada. En cualquier orden, el
tablero acaba igual: ninguna tarjeta en una columna borrada. Un solo caso de uso sirve a
los dos, `leaveRemovedColumn`, siempre que compruebe las dos cosas: hay una tarjeta en la
columna, y la columna ya no está.

### Nadie lo hizo

Los eventos de las tarjetas dicen quién hizo qué (`by`, `via`, desde el capítulo 10). Un
caso de uso que llama un worker se ejecuta sin actor: `currentActor()` lanzaría un error.
No hay ninguna persona detrás; boards lo hace por su cuenta. Dilo con un autor de nadie.
Añádelo a `card.module.ts`, después de los imports de los eventos, junto con el import de
`ColumnDTO`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { runInWorkspace } from '../../workspace-scope'
import type { ColumnDTO } from '../column/column.schema'
// …
import { Card_Unassigned } from './events/card-unassigned'

/** Boards' own work, from a worker: no one did it. */
const BOARDS: CardAuthor = { by: null, via: null }
```

`CardAuthor` ya lo permite (`by: string | null`): el registro de actividad anota una
entrada así sin actor.

### El caso de uso

Añade `leaveRemovedColumn` justo después de `removeColumn`, y termina el comentario de
`removeColumn` diciendo quién se ocupa de lo que deja:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
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

  /**
   * A column may be gone: any card still in it goes to the bottom of the board's first
   * column. What a worker calls when a column is removed, and when a card is created
   * in one or moved to one: the card checked its column before its save, and the
   * column may have gone in between, its own worker finding no card yet. Each runs after
   * its own save and looks at the other's, so whichever runs last finds the card.
   * Safe to run again: a column still there, or with no card in it, is left as it is.
   */
  @UseCase()
  async leaveRemovedColumn(column: Pick<ColumnDTO, 'id' | 'boardId' | 'workspaceId'>): Promise<void> {
    await runInWorkspace(column.workspaceId, async () => {
      const left = await this.repo.inColumn(column.id)
      if (left.length === 0) return
      const columns = await this.deps.column.list(column.boardId)
      if (columns.some(each => each.id === column.id)) return
      const [first] = columns
      // Never none: a board keeps one column at least (`column.remove`).
      if (!first) return
      const bottom = await this.repo.count({ columnId: first.id })
      left.forEach((card, index) => card.moveTo(first.id, bottom + index, BOARDS))
      await this.repo.persistOrder(left, [column.id, first.id])
    })
  }
```

Paso a paso:

- Recibe la columna como `Pick<ColumnDTO, 'id' | 'boardId' | 'workspaceId'>`: lo que
  necesita de ella. `column.removed` lleva el DTO entero, que encaja; el evento de una
  tarjeta entrega solo el id de su columna, su tablero y su workspace.
- Un worker no se ejecuta en ningún workspace. La columna lleva su `workspaceId`, así que
  el caso de uso entra en él con `runInWorkspace` (como hizo `notifyAssignee` en el
  [capítulo 12](./12-failures)), y los repositorios ven las filas de ese workspace.
- Busca tarjetas en la columna. Casi siempre no hay ninguna, y termina: el borrado normal
  pasó por `removeColumn`, que lo comprobó, y el movimiento normal va a una columna que
  se queda.
- Lee las columnas del tablero. Si la columna sigue entre ellas, termina: la tarjeta está
  donde debe. Esta es la comprobación que deja al worker de una tarjeta llamarlo después
  de cada movimiento; y cuando el worker de una tarjeta se ejecuta antes de guardarse el
  borrado, es el propio worker de la columna, más tarde, el que encuentra la tarjeta.
- La primera columna es ahora la primera del tablero, tras el borrado: `column.list` ya
  no muestra la borrada. Un tablero conserva al menos una columna, así que siempre hay
  una; el `if (!first)` solo se lo dice a TypeScript.
- Las tarjetas van al final de esa columna, en su orden, con `moveTo` por `BOARDS`. Cada
  una emite `card.moved`, como cualquier movimiento.
- `persistOrder` (del [capítulo 8](./08-two-people-one-card)) las guarda, protegiendo las
  dos columnas y comprobando su orden después de escribir. Una tarjeta que alguien movió
  mientras tanto es un conflicto, y el caso de uso se ejecuta otra vez con lo que haya
  entonces.

Ejecútalo una segunda vez y no encuentra ninguna tarjeta en la columna borrada, y no hace
nada. Eso importa, porque un worker puede ejecutarlo más de una vez, y porque ahora hasta
dos workers lo ejecutan para la misma tarjeta.

El comentario del propio módulo de columnas sobre `remove` dice lo mismo, para que quien
lo lea sepa que una tarjeta puede quedarse en la columna, qué pasa con ella, y por qué la
última columna se queda. Sustitúyelo en `column.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /**
   * Removes a column, and the ones to its right move one place left. Whether it is
   * empty is not known here, where cards are not: `card.removeColumn` asks the cards
   * first, and is what the API calls. A card left in it anyway (moved in at that very
   * moment) is taken to another column by a worker of the cards, so a board keeps one
   * column at least: its last one is not removed.
   */
  @UseCase()
  async remove(id: string): Promise<void> {
```

Las suscripciones vienen más abajo, junto a las demás, en `card.workers.ts`.

## Los eventos de auth, como un puerto

Ahora Bea. boards quiere enterarse de que alguien perdió su acceso. Ese evento es de auth,
y aún no hay auth (llega en el [capítulo 17](./17-auth)): no hay nada que importar.

Así que el módulo de tarjetas dice lo que necesita, con sus propias palabras, en su
archivo de deps. No el módulo de acceso de auth: solo algo a lo que pueda **suscribirse**.
Eso es el **`EventSource<T>`** de newt, de `newt/core`: el `subscribe` de un emisor, nada
más. El `events.<name>` de cualquier módulo encaja, y también lo que entregue un test.

Sustituye `card.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
import type { EventSource } from 'newt/core'
import type { Board_Module } from '../board/board.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

/**
 * Someone's access to a product of auth's: to a workspace of `cooper` (`tenantId`),
 * or to a product with none (null, the backoffice's staff).
 */
export type RevokedAccess = { userId: string, productId: string, tenantId: string | null }

/**
 * auth's events the cards react to, as a port: what boards needs of them, in its own
 * words. auth's emitters fit it; a test hands its own.
 */
export type AccessEvents = {
  /** Someone lost their access to a product of auth's. */
  revoked: EventSource<RevokedAccess>
}

export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board; and where cards left in a removed column go. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
  access: AccessEvents
}
```

- `RevokedAccess` es el payload que boards espera: quién, a qué producto y en qué tenant.
  auth da acceso a más cosas que workspaces: el backoffice también es un producto, sin
  tenant (`null`). A boards solo le importan los workspaces, pero el puerto dice lo que
  auth cuenta de verdad, para que el emisor de auth encaje tal cual.
- Es un `type`, no una `interface`: el payload de un evento es JSON, y TypeScript solo
  acepta un alias de tipo como JSON (la misma regla que para los payloads de tus propios
  eventos en el capítulo 10).
- `AccessEvents` agrupa los eventos de auth sobre acceso que boards oye. Uno por ahora.
- `Card_Deps` recibe `access`, junto a los módulos que ya tenía. El comentario de la
  columna añade lo que las tarjetas le piden ahora: a dónde van las tarjetas que quedan
  en una columna borrada.

El puerto es lo que se le da a boards, no lo que alcanza por su cuenta. Lo entrega quien
abre el contexto: ahora un auth falso. Como `Workspaces`, es un sustituto hasta que
exista auth: en el [capítulo 20](./20-wiring-contexts) el módulo de tarjetas recibe el
módulo de accesos de auth mismo, y se suscribe a su `events.revoked`.

## Dejar las tarjetas sin asignado

Cuando Bea pierde el acceso, sus tarjetas de ese workspace se quedan sin asignado. La
misma carrera está aquí, en el otro par de guardados. `card.assign` comprueba que el
asignado pertenece (`assertMember` pregunta a auth, a través del módulo de miembros), y
luego guarda. Entre la comprobación y el guardado, Bea puede irse y el worker de auth
puede ejecutarse, no encontrar aún ninguna tarjeta suya, y terminar. Luego llega la
asignación, y Bea tiene una tarjeta en un workspace en el que no está. `card.create` con
asignado tiene el mismo hueco.

El arreglo tiene la misma forma. El worker de auth se ejecuta después del guardado de auth
y mira las tarjetas. El worker de la tarjeta se ejecuta después del guardado de la tarjeta
y mira auth: ¿sigue perteneciendo el asignado? El que se ejecute el último ve los dos.
Añade `unassignMember` a `card.module.ts`, después de `notifyAssignee`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Someone may have lost their access to a workspace: if they do not belong to it,
   * its cards they had are left without an assignee. What a worker calls when auth
   * takes their access away, and when a card is given to someone (created for them,
   * or assigned): they were checked before its save, and may have left in between,
   * auth's worker finding no card of theirs yet. Each runs after its own save and
   * looks at the other's, so whichever runs last finds the card. Asked again here,
   * someone let in again since keeps their cards. Safe to run again.
   */
  @UseCase()
  async unassignMember(workspaceId: string, userId: string): Promise<void> {
    if (await this.deps.member.find(workspaceId, userId)) return
    await runInWorkspace(workspaceId, async () => {
      const cards = await this.repo.find({ assigneeId: userId })
      for (const card of cards) card.unassign(BOARDS)
      await this.repo.persist(...cards)
    })
  }
```

- Primero pregunta si la persona pertenece ahora al workspace, con el `find` del módulo
  de miembros (el que usa un worker, del [capítulo 12](./12-failures)). Si pertenece,
  termina. Esa sola línea hace tres trabajos. Es lo que hace seguro llamar al caso de uso
  después de **cada** asignación: quien pertenece conserva su tarjeta. Cierra la carrera
  desde el lado de la tarjeta: a quien se fue se le encuentra ido. Y quien se fue y volvió
  a entrar antes de que se ejecutara el worker de auth conserva sus tarjetas: el evento
  dice que se fue, pero ahora pertenece, y lo que cuenta es ahora.
- Luego entra en el workspace, busca las tarjetas asignadas a esa persona, desasigna cada
  una por `BOARDS`, y las guarda todas en un solo guardado. Cada tarjeta emite
  `card.unassigned`, así que el registro de actividad lo anota, sin actor.

Una segunda ejecución no encuentra ninguna tarjeta suya, no guarda nada, y termina.

## Qué eventos: `when`, con un type guard

Todas las reacciones van en `card.workers.ts`. Sustitúyelo:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
import type { CardAuthor, CardDTO } from './card.schema'
import type { Card_Deps, RevokedAccess } from './card.deps'
import type { Card_Module } from './card.module'

/** A new card, given to someone: what `when` lets through to check they still belong. */
type CreatedFor = CardDTO & CardAuthor & { assigneeId: string }

/**
 * What the cards do when something happens, each a job saved with what it reacts to,
 * run by a worker until it succeeds, and safe to run again.
 */
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them, by someone else.
  cards.events.created.subscribe(({ by, ...card }, { id }) => cards.notifyAssignee(card, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
    when: card => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto, by }, { id }) => cards.notifyAssignee(dto, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.assigned',
  })

  // A card points at its column: when a column goes, no card is left in it. A card
  // checks its column before its save, so the column may go in between: a card
  // created in one, or moved to one, looks again once saved. Whichever looks last finds it.
  deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.column.removed',
  })
  cards.events.created.subscribe(card => cards.leaveRemovedColumn({ id: card.columnId, boardId: card.boardId, workspaceId: card.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.created',
  })
  cards.events.moved.subscribe(({ dto }) => cards.leaveRemovedColumn({ id: dto.columnId, boardId: dto.boardId, workspaceId: dto.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.moved',
    when: ({ changes }) => changes.columnId !== undefined,
  })

  // auth took someone's access to a workspace: their cards there are left unassigned.
  // auth tells every access it takes away, to any product: only a workspace's is boards'.
  // A card checks its assignee before its save, so they may leave in between: a card
  // created for someone, or given to them, looks again once saved, the same way.
  // For now the product is named here: auth's WORKSPACES_PRODUCT (chapter 17) takes its place.
  deps.access.revoked.subscribe(access => cards.unassignMember(access.tenantId, access.userId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
    when: (access: RevokedAccess): access is RevokedAccess & { tenantId: string } => access.productId === 'cooper' && access.tenantId !== null,
  })
  cards.events.created.subscribe(card => cards.unassignMember(card.workspaceId, card.assigneeId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.card.created',
    when: (card: CardDTO & CardAuthor): card is CreatedFor => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto }) => cards.unassignMember(dto.workspaceId, dto.assigneeId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.card.assigned',
  })
}
```

Cinco suscripciones nuevas, en dos grupos.

**La columna.** `card.leaveRemovedColumn.on.column.removed` es el seguidor de la columna.
Es un `handler`, como el email del capítulo 12: un job guardado con el borrado, en la
misma transacción, y ejecutado hasta que se completa. Su cola sigue la regla de nombres:
`card.leaveRemovedColumn`, el módulo y el caso de uso que reaccionan,
`.on.column.removed`, el evento. Luego los seguidores de la tarjeta: `…on.card.created`
entrega la columna de la tarjeta nueva, y `…on.card.moved` la columna a la que se movió la
tarjeta. Un movimiento dentro de una columna, o una reordenación, no cambia de columna: su
`when` solo deja pasar un movimiento cuyos `changes` dicen un `columnId` nuevo, así que una
tarjeta arrastrada dentro de su columna no escribe ningún job para esto.

**El asignado.** `card.unassignMember.on.access.revoked` es el seguidor de auth. auth
cuenta todos los accesos que quita, a cualquier producto, y boards solo quiere los de un
workspace de cooper. Luego los seguidores de la tarjeta: `…on.card.created` para una
tarjeta creada para alguien, y `…on.card.assigned` para una tarjeta dada a alguien.

Conociste `when` en el capítulo 12, donde el email de una tarjeta nueva solo se envía si
tiene asignado. Aquí hace un segundo trabajo.

- **Decide qué eventos reciben un job.** `when` se ejecuta en la transacción del guardado
  que emite el evento, antes de escribir ningún job. Un evento que no acepta no deja
  ningún job: un miembro del personal que pierde el backoffice no escribe nada para
  boards, y una tarjeta creada sin asignado no escribe ningún job de `unassignMember`.
  Solo mira el payload; si el evento importa o no es cosa de `when`, nunca de la lógica
  de negocio del caso de uso.
- **Escrito como un type guard, acota lo que recibe el callback.** El payload dice
  `tenantId: string | null`, y `unassignMember` recibe un `string`. El guard
  `(access: RevokedAccess): access is RevokedAccess & { tenantId: string }` le dice a
  TypeScript que todo lo que pasa tiene tenant, así que el callback puede pasar
  `access.tenantId` directamente al caso de uso. Un `when` que devolviera un booleano
  normal filtraría los mismos eventos, pero el callback seguiría viendo `string | null`, y
  la llamada no compilaría. Tipa el parámetro, como aquí, para que el guard funcione.

El payload de `card.created` es la tarjeta y su autor, con `assigneeId: string | null`.
El archivo nombra lo que deja pasar su guard, `CreatedFor`: una tarjeta con asignado. El
guard `(card: CardDTO & CardAuthor): card is CreatedFor` convierte `card.assigneeId` en un
`string` dentro del callback.

Por ahora el nombre del producto está escrito aquí como `'cooper'`. auth lo nombra con
una constante, `WORKSPACES_PRODUCT`, que aquí no se puede usar hasta el capítulo 20; entonces
sustituirá al string.

### Una asignación siempre tiene asignado

`card.assigned` no tiene `when`: una asignación siempre tiene asignado. Pero el tipo de su
payload no lo decía. `dto` era un `CardDTO`, cuyo `assigneeId` es `string | null`, y
`unassignMember(dto.workspaceId, dto.assigneeId)` no compilaría. Dilo en el evento. En
`events/card-assigned.ts`:

```ts
// cooper/backend/contexts/boards/modules/card/events/card-assigned.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card, now assigned to `dto.assigneeId`, who had it before, if anyone, and who assigned it. */
type CardAssignment = { dto: CardDTO & { assigneeId: string }, previousAssigneeId: string | null } & CardAuthor & { by: string }

export class Card_Assigned implements DomainEvent<CardAssignment> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardAssignment) {}
}
```

y en `card.ts`, `assign` construye el DTO con el asignado que recibió, un `string`, para
que TypeScript lo vea:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
  /** To a member of its workspace, by someone: the module checked they are. Assigning it again to the same one changes nothing. */
  assign(assigneeId: string, author: CardAuthor & { by: string }): void {
    const previousAssigneeId = this.data.assigneeId
    if (assigneeId === previousAssigneeId) return
    this.change({ assigneeId })
    this.trackEvent(new Card_Assigned({ dto: { ...this.toDTO(), assigneeId }, previousAssigneeId, ...author }))
  }
```

El JSON es el mismo que antes: `toDTO()` ya tenía ese asignado.

## En cualquier orden

Esta es la idea entera, para los dos pares de guardados. Cada columna es un orden posible
de los dos workers:

| | El worker del otro lado se ejecuta primero | El worker de la tarjeta se ejecuta primero |
|---|---|---|
| Tarjeta movida a, o creada en, una columna que se está borrando | El worker de la columna aún no encuentra ninguna tarjeta. El de la tarjeta, tras el guardado de la tarjeta, encuentra su columna borrada: mueve la tarjeta. | El worker de la tarjeta encuentra su columna todavía ahí. El de la columna, tras el borrado, encuentra la tarjeta en ella: mueve la tarjeta. |
| Tarjeta dada a, o creada para, alguien que se va | El worker de auth aún no encuentra ninguna tarjeta suya. El de la tarjeta, tras el guardado de la tarjeta, encuentra que se fue: desasigna la tarjeta. | El worker de la tarjeta encuentra que se fue: desasigna la tarjeta. El de auth, más tarde, no encuentra nada más. |

Nada se bloquea, nada espera, nada pide al otro contexto que se quede quieto. Cada lado
hace su parte después de su propio guardado, lee el estado del otro tal como está
entonces, y el resultado es el mismo en cualquier orden. Eso es lo que significa aquí
*consistencia eventual*: durante un momento una tarjeta puede estar en una columna
borrada, o con un asignado que se fue; un momento después, sea cual sea el orden, ya no.

Dos cosas lo sostienen:

- **Cada seguidor comprueba el estado, no el evento.** `leaveRemovedColumn` pregunta si la
  columna ya no está *ahora*, no si algún evento lo dijo; `unassignMember` pregunta si la
  persona pertenece *ahora*. Un seguidor que se fiara de su evento desasignaría a alguien
  que volvió a entrar, o sacaría una tarjeta de una columna que sigue ahí.
- **Cada seguidor se puede ejecutar otra vez, y para nada, sin riesgo.** La mayoría de sus
  ejecuciones no encuentran nada que hacer. Ese es su caso normal.

## La regla de escritura

Mira quién escribe qué. `access.revoked` lo emite auth, en el guardado de auth. Las
tarjetas las desasigna el módulo de tarjetas, en el guardado de boards. auth nunca toca
una tarjeta; boards nunca toca un acceso. El caso de la columna es el mismo dentro de
boards: el módulo de columnas borra la columna, y el módulo de tarjetas mueve las
tarjetas.

Esa es la regla que el [capítulo 8](./08-two-people-one-card) nombró cuando `removeColumn`
necesitó una excepción: **solo un worker escribe en otro módulo**. Cuando algo de un
módulo tiene una consecuencia en otro, el primero emite un evento y el segundo reacciona,
desde un worker. El job se guarda con el cambio que emite el evento, así que se guardan
los dos o ninguno, y se ejecuta otra vez hasta que se completa. Una llamada directa de
auth a boards serían dos guardados sin nada que termine el segundo si fallara; y auth
tendría que conocer boards.

Aquí ninguna reacción cruza siquiera a otro módulo: cada una es un caso de uso del módulo
de tarjetas que escribe las filas del módulo de tarjetas. El
[capítulo 14](./14-sagas) tiene uno que escribe en tres, y muestra a newt comprobando la
regla mientras se ejecuta.

## El worker que lo ejecuta

El job de un `handler` se escribe en la transacción del guardado que emite el evento, y
en el store de ese guardado. `access.revoked` se emite en el store de auth, así que el
job de `card.unassignMember.on.access.revoked` está en el **outbox de auth**, y lo
ejecuta el worker de auth. Este llama al caso de uso de boards, que guarda en el store de
boards. Desasignar emite `card.unassigned`, cuyo job de actividad está en el **outbox de
boards**, y lo ejecuta el worker de boards.

```text
store de auth                             store de boards
┌───────────────────────────────┐
│ acceso revocado               │
│ job: card.unassignMember.on.  │ ──▶ card.unassignMember ──▶ ┌──────────────────────────┐
│      access.revoked           │     (worker de auth)         │ card: assigneeId = null  │
└───────────────────────────────┘                              │ job: activity.record...  │ ──▶ worker de boards
                                                               └──────────────────────────┘
```

El seguidor de la tarjeta, `card.unassignMember.on.card.assigned`, se emite en el store de
boards, así que su job está en el outbox de boards. Las dos mitades de la carrera las
ejecutan dos workers distintos, de dos contextos distintos, cada uno cuando le toca: nadie
puede decir cuál se ejecuta primero. Por eso cada uno debe comprobar el otro lado, en vez
de contar con un orden.

Así que esperar "el trabajo en segundo plano" significa ahora esperar primero los jobs de
auth, y luego los de boards.

## Un auth falso que cuenta

auth aún no existe. `FakeAuth` (del [capítulo 4](./04-who-and-where)) responde desde
memoria quién pertenece a cada workspace. Ahora también emite `access.revoked`, como lo
hará auth: desde un store propio, para que los handlers de boards sean jobs de su outbox
y solo se ejecuten cuando su worker los ejecute. Sustituye `testing/fake-auth.ts`:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
import { SqliteStore } from 'newt/adapter-sqlite'
import { Email } from 'newt/contract'
import { eventsOf, now, type DomainEvent } from 'newt/core'
import { Base } from 'newt/runtime'
import type { AccessEvents } from '../modules/card/card.deps'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'

type Access = { userId: string, productId: string, tenantId: string | null }

class Access_Revoked implements DomainEvent<Access> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: Access) {}
}

/**
 * auth, as `boards`' tests need it: who belongs to each workspace, kept in memory, and
 * auth's events about access, told as auth tells them. Each event is
 * published in a transaction of its own store, so boards' handlers are jobs of its
 * worker, as they are of auth's, and run only on `idle`.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** The port of who belongs to each workspace. */
  readonly workspaces: Workspaces = {
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
    member: async (workspaceId, userId) => this.members.get(workspaceId)?.get(userId) ?? null,
  }

  readonly access: AccessEvents

  private constructor(private readonly base: Base) {
    this.access = eventsOf(base.bus, { revoked: Access_Revoked })
  }

  static async open(): Promise<FakeAuth> {
    return new FakeAuth(new Base({ name: 'auth', store: await SqliteStore.open({ path: ':memory:' }) }))
  }

  /** Someone joins a workspace: `<userId>@cooper.test`, named after their id. */
  join(workspaceId: string, userId: string): MemberDTO {
    const member = { id: userId, name: userId, email: Email.from(`${userId}@cooper.test`) }
    const members = this.members.get(workspaceId) ?? new Map<string, MemberDTO>()
    members.set(userId, member)
    this.members.set(workspaceId, members)
    return member
  }

  /** Someone leaves a workspace: `access.revoked`. */
  async revoke(workspaceId: string, userId: string): Promise<void> {
    this.members.get(workspaceId)?.delete(userId)
    await this.tell(new Access_Revoked({ userId, productId: 'cooper', tenantId: workspaceId }))
  }

  /** Until the jobs of its events are done: boards' reactions. */
  idle(): Promise<void> {
    return this.base.jobs.idle()
  }

  close(): Promise<void> {
    return this.base.close()
  }

  private async tell(event: DomainEvent): Promise<void> {
    await this.base.store.transaction(() => this.base.bus.publish(event))
  }
}
```

- `Access_Revoked` es una clase de evento como las que escribiste en el capítulo 10: un
  `eventName` estático, el `name`, cuándo ocurrió (`now()`, el reloj de `newt/core`, como
  usan tus eventos) y el payload.
- `FakeAuth.open` crea una `Base` llamada `auth` sobre un `SqliteStore` en memoria: un bus
  y un outbox, y nada más.
- `access` es `eventsOf(base.bus, { revoked: Access_Revoked })`, como cada módulo de
  boards crea sus `events`. Encaja con `AccessEvents`.
- `revoke` saca a la persona del workspace y emite `access.revoked`.
- `tell` publica en el bus dentro de una transacción de su store. Tus eventos los publica
  el guardado de un repositorio; algo que no es una entidad puede publicar directamente en
  `base.bus`, con las mismas garantías: sus jobs se escriben en la transacción en curso.
  FakeAuth no tiene entidad, así que abre una propia.
- `idle` ejecuta los jobs de auth hasta que no queda ninguno, y `close` cierra su store.
  Nada arranca el worker de FakeAuth: en un test, sus jobs se ejecutan cuando el test los
  espera.

## Conectarlo

`Boards_ModuleDeps`, lo que quien abre boards entrega a sus módulos, recibe `access`, y el
módulo de tarjetas lo recibe. En `initialize-modules.ts`, importa el puerto, añádelo al
tipo y a su comentario, y pásalo a `Card_Module.initialize`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import { Activity_Module } from './modules/activity/activity.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Board_Module } from './modules/board/board.module'
// …
/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about access), and a
 * mailer. Whoever opens the context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  access: AccessEvents
  mailer: Mailer
// …
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
```

El helper de tests entrega los eventos de FakeAuth, espera los jobs de auth antes que los
de boards en `settled`, y cierra auth después de boards. En
`testing/open-test-boards.ts`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    access: auth.access,
    mailer,
    log: line => { lines.push(line) },
  })
// …
    /** Until the background work is done: auth's events heard, and what they made boards tell. */
    async settled(): Promise<void> {
      await auth.idle()
      await boards.base.jobs.idle()
    },
    async close(): Promise<void> {
      await boards.stop()
      await auth.close()
    },
```

El servidor de desarrollo también los entrega, en `index.ts`:

```ts
// cooper/backend/index.ts
const boards = await Boards_Context.open(config.boards, {
  workspaces: auth.workspaces,
  access: auth.access,
  mailer: new ConsoleMailer(config.mail.from),
  log: line => console.log(line),
})
```

Nada en el servidor de desarrollo revoca aún un acceso, así que no hay nada que probar
ahí a mano.

## Tests

En `activity.test.ts`, después del primer test, una tarjeta de Bea, y Bea que se va. La
última entrada de su actividad es la desasignación, por nadie:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
  test('credits nobody for what boards does on its own, from a worker', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan', assigneeId: 'bea' }))
    await t.auth.revoke('acme', 'bea')
    await t.settled()

    const [latest] = (await activityOf(card.id)).items
    expect(latest).toMatchObject({ kind: 'unassigned', actorId: null, via: null, detail: { previousAssigneeId: 'bea' } })
  })
```

Recorre toda la cadena: FakeAuth emite, el worker de auth ejecuta `unassignMember`, la
tarjeta emite `card.unassigned`, el worker de boards lo anota. Un solo `settled()` lo
espera todo.

### Pausar un caso de uso: `hold`

Las carreras necesitan que dos cosas ocurran en un orden preciso: un caso de uso parado
entre su comprobación y su guardado, y otra cosa hecha mientras tanto. En un test ese
orden lo pones tú. En `card.test.ts`, importa `spyOn` de `bun:test`:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
```

y añade tres helpers después de `columns`:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  /** Where a card is now, and its assignee. */
  const card = (id: string) => inAcme(() => t.modules.card.get(id))
  /** The board's first column, where the cards of a removed one go. */
  const firstColumn = async () => (await inAcme(() => t.modules.column.list(boardId)))[0]!.id
  /**
   * The next call of a use case waits until `release`: before it runs, or after it
   * read what it answers. A use case paused between its check and its save, or
   * another one's, for something else to happen in between.
   */
  function hold<M extends object>(module: M, useCase: keyof M & string, at: 'before' | 'after') {
    const original = (module[useCase] as (...args: unknown[]) => Promise<unknown>).bind(module)
    const { promise: reached, resolve: reach } = Promise.withResolvers<void>()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()
    spyOn(module, useCase as never).mockImplementationOnce((async (...args: unknown[]) => {
      if (at === 'before') { reach(); await released }
      const answer = await original(...args)
      if (at === 'after') { reach(); await released }
      return answer
    }) as never)
    return { reached, release }
  }
```

- `card(id)` lee una tarjeta tal como está ahora; `firstColumn()` es la primera columna
  del tablero, adonde van las tarjetas de una borrada.
- `hold(module, useCase, at)` hace que la **siguiente** llamada a un caso de uso espere. El
  `spyOn` de Bun sustituye el método en el módulo, y `mockImplementationOnce` solo para
  una llamada; las siguientes se ejecutan como siempre. La sustitución llama al original,
  y se para `'before'` (antes) de ejecutarlo o `'after'` (después) de que respondió.
  Resuelve `reached` cuando se para, y espera a `release`.

El truco está en qué caso de uso retienes. `card.move` comprueba su columna llamando a
`column.list`; retén `column.list` `'after'`, y el movimiento ha hecho su comprobación y
espera antes de su guardado. `card.removeColumn` cuenta las tarjetas, y luego llama a
`column.remove`; retén `column.remove` `'before'`, y el borrado ha contado y espera antes
de su guardado. Del mismo modo, retener `member.isMember` `'after'` para una asignación
que ya ha comprobado su asignado. Un spy sobre el caso de uso de otro módulo es una costura que
es del test: nada en el módulo de tarjetas cambia por ella.

### Siete carreras

Añade los tests de carreras después de "moves a card only to a column of its board". Los
dos primeros son un movimiento a una columna que se está borrando, una vez en cada orden:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('takes a card moved into a column being removed to the first column, when the column\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The move checked the column is there, and waits to save.
    const checked = hold(t.modules.column, 'list', 'after')
    const moving = inAcme(() => t.modules.card.move(plan.id, { columnId: done }))
    await checked.reached

    await inAcme(() => t.modules.card.removeColumn(done))
    // Its worker finds no card in it yet.
    await t.settled()
    checked.release()
    await moving
    expect((await card(plan.id)).columnId).toBe(done)

    // The card's worker, after its save, finds its column gone.
    await t.settled()
    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })
```

El movimiento comprueba *Done* y se para. El borrado se ejecuta entero: no cuenta ninguna
tarjeta en *Done*, la borra, y `settled()` ejecuta su worker, que no encuentra nada.
Liberado, el movimiento guarda la #1 en *Done*, ya borrada: el test la ve ahí, el hueco
del capítulo 8. El segundo `settled()` ejecuta el worker de la tarjeta, que encuentra su
columna borrada y lleva la tarjeta a la primera columna.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('takes a card moved into a column being removed to the first column, when the card\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The removal found the column empty, and waits to save.
    const counted = hold(t.modules.column, 'remove', 'before')
    const removing = inAcme(() => t.modules.card.removeColumn(done))
    await counted.reached

    await inAcme(() => t.modules.card.move(plan.id, { columnId: done }))
    // The card's worker finds its column still there.
    await t.settled()
    counted.release()
    await removing
    expect((await card(plan.id)).columnId).toBe(done)

    // The column's worker, after its save, finds the card in it.
    await t.settled()
    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })
```

El otro orden. El borrado no cuenta ninguna tarjeta y se para antes de borrar. El
movimiento entra entero, y su worker encuentra *Done* todavía ahí: nada que hacer.
Liberado, el borrado guarda; su worker encuentra la #1 en *Done* y la mueve.

Una tarjeta creada en una columna que se está borrando:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('takes a card created in a column being removed to the first column', async () => {
    const checked = hold(t.modules.column, 'list', 'after')
    const creating = create('Plan', { columnId: done })
    await checked.reached
    await inAcme(() => t.modules.card.removeColumn(done))
    await t.settled()
    checked.release()
    const plan = await creating

    await t.settled()

    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })
```

Luego el asignado, en cada orden:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('leaves unassigned a card given to someone as they leave the workspace, when auth\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The assignment checked bea belongs, and waits to save.
    const checked = hold(t.modules.member, 'isMember', 'after')
    const assigning = inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await checked.reached

    await t.auth.revoke('acme', 'bea')
    // auth's worker finds no card of hers yet.
    await t.settled()
    checked.release()
    await assigning
    expect((await card(plan.id)).assigneeId).toBe('bea')

    // The card's worker, after its save, finds she has left.
    await t.settled()
    expect((await card(plan.id)).assigneeId).toBeNull()
    expect(t.mails).toEqual([])
  })
```

La asignación comprueba a Bea y se para. Ella se va, y `settled()` ejecuta el worker de
auth, que no encuentra ninguna tarjeta suya. Liberada, la asignación guarda: la #1 es de
Bea, durante un momento. El siguiente `settled()` ejecuta los seguidores de la tarjeta:
`unassignMember` encuentra que se fue y desasigna; `notifyAssignee` encuentra que se fue y
no envía nada.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('leaves unassigned a card given to someone as they leave the workspace, when the card\'s worker runs first', async () => {
    const plan = await create('Plan')
    const checked = hold(t.modules.member, 'isMember', 'after')
    const assigning = inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await checked.reached
    // She has left, and auth's worker has not run yet.
    await t.auth.revoke('acme', 'bea')
    checked.release()
    await assigning

    // The card's worker, after its save, finds she has left; auth's, after, finds nothing more.
    await t.boards.base.jobs.idle()
    expect((await card(plan.id)).assigneeId).toBeNull()
    await t.settled()
    expect((await card(plan.id)).assigneeId).toBeNull()
    expect(t.mails).toEqual([])
  })
```

Aquí el worker de auth tiene que esperar, así que el test no llama a `settled()`, que
ejecuta primero los jobs de auth. Ejecuta solo los jobs de boards, con
`t.boards.base.jobs.idle()`: el worker de la tarjeta encuentra que Bea se fue y desasigna.
Luego `settled()` ejecuta el worker de auth, que no encuentra nada más.

Una tarjeta creada para alguien que se va, y alguien que vuelve:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('leaves unassigned a card created for someone as they leave the workspace', async () => {
    const checked = hold(t.modules.member, 'isMember', 'after')
    const creating = create('Plan', { assigneeId: 'bea' })
    await checked.reached
    await t.auth.revoke('acme', 'bea')
    await t.settled()
    checked.release()
    const plan = await creating

    await t.settled()

    expect((await card(plan.id)).assigneeId).toBeNull()
  })

  test('keeps the cards of someone let in again before auth\'s worker ran', async () => {
    const plan = await create('Plan', { assigneeId: 'bea' })
    await t.auth.revoke('acme', 'bea')
    t.auth.join('acme', 'bea')

    await t.settled()

    expect((await card(plan.id)).assigneeId).toBe('bea')
  })
```

El último es la razón por la que `unassignMember` pregunta antes de actuar. Bea se va y
vuelve a entrar antes de que se ejecute el worker de auth. El evento dice que se fue;
ahora pertenece, y conserva su tarjeta.

### El propio worker de la columna

Por último, después del test del email a nadie, la columna borrada con una tarjeta ya
dentro. El test llama a `column.remove` directamente, saltándose la comprobación de
`removeColumn`, que es lo que deja la carrera:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('takes a card left in a removed column to the first one of its board, a moment later', async () => {
    await create('Already there', { columnId: doing })
    await create('Plan')

    // As if a card were moved into it while it was being removed: the column goes with a card in it.
    await inAcme(() => t.modules.column.remove(todo))
    await t.settled()

    expect(await columns()).toEqual({ todo: [], doing: ['#1@0', '#2@1'], done: [] })
  })
```

La tarjeta #2 estaba en *To do*. Una vez que *To do* ya no está, *Doing* es la primera
columna del tablero, y la #2 aterriza al final de ella, debajo de la #1. (Este test pasa
a los tests propios del workspace en el próximo capítulo, sobre un tablero de bienvenida.)

## Compruébalo

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

```text
 52 pass
 0 fail
```

Los tests nuevos por separado:

```sh
bun test cooper/ -t 'credits nobody|being removed|removed column|leave the workspace|let in again'
```

```text
 9 pass
 43 filtered out
 0 fail
 15 expect() calls
Ran 9 tests across 6 files.
```

## En resumen

- Mientras otro contexto no está construido, lo que un módulo necesita de él es un
  puerto en sus propias deps, con sus propias palabras. Para eventos, un
  `EventSource<T>`: solo `subscribe`. Un test entrega el suyo; los módulos del otro
  contexto ocupan su lugar cuando existe.
- `when` elige qué eventos reciben un job, en la transacción que los emite, así que un
  evento que no acepta no deja nada. Escrito como un type guard con el parámetro tipado,
  acota lo que recibe el callback.
- Solo un worker escribe en otro módulo. Una consecuencia en los datos de otro es un
  evento emitido y una reacción desde un worker, nunca una escritura directa.
- Cuando dos guardados compiten (una comprobación y luego un guardado, en cada lado), da a
  cada lado un seguidor que se ejecute después de su propio guardado y compruebe el
  estado del otro lado ahora. El que se ejecute el último ve los dos, así que el
  resultado es el mismo en cualquier orden.
- Lo que boards hace por su cuenta lo hace nadie: `{ by: null, via: null }`. Un worker no
  tiene actor, y entra en el workspace que nombra el evento con `runInWorkspace`.
- Una reacción puede ejecutarse dos veces, o para nada. Haz que esas ejecuciones no
  encuentren nada que hacer: ninguna tarjeta en la columna, ninguna tarjeta suya que siga
  asignada, una columna que sigue ahí que se deja como está.

Siguiente: [Sagas: un workspace llega y se va](./14-sagas).
