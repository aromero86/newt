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
un hueco en `removeColumn`: una tarjeta movida a una columna entre el recuento y el
borrado acaba en una columna que ya no existe. También eso es algo que pasó
(`column.removed`, que emite el módulo de columnas) y cuya consecuencia es de otro (las
tarjetas).

Este capítulo añade las dos reacciones al módulo de tarjetas. Cada una es trabajo propio
de boards, hecho por nadie en particular, desde un worker, y cada una se puede ejecutar
otra vez sin riesgo.

## Una tarjeta en una columna borrada

Recuerda el hueco. `card.removeColumn` cuenta las tarjetas de la columna y, si no hay
ninguna, hace que el módulo de columnas la borre. Entre el recuento y el borrado, Carla
mueve una tarjeta a esa columna. El recuento dijo cero, la columna se va, y la tarjeta de
Carla apunta a una columna que ninguna lista muestra. Su tarjeta se pierde del tablero.

No puedes cerrarlo contando mejor: el recuento y el borrado son guardados de dos
módulos, y el módulo de columnas no sabe nada de tarjetas. Así que dejas que el hueco
ocurra y lo limpias justo después. Borrar una columna emite `column.removed` (desde el
[capítulo 10](./10-events)), con la columna en su payload. El módulo de tarjetas escucha,
y lleva cualquier tarjeta que siga en esa columna a la primera del tablero.

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
   * A column was removed: any card still in it goes to the bottom of the board's
   * first column. What a worker calls; the second time, there are none.
   */
  @UseCase()
  async leaveRemovedColumn(column: ColumnDTO): Promise<void> {
    await runInWorkspace(column.workspaceId, async () => {
      const left = await this.repo.inColumn(column.id)
      if (left.length === 0) return
      const [first] = await this.deps.column.list(column.boardId)
      if (!first) return
      const bottom = await this.repo.count({ columnId: first.id })
      left.forEach((card, index) => card.moveTo(first.id, bottom + index, BOARDS))
      await this.repo.persistOrder(left, [column.id, first.id])
    })
  }
```

Paso a paso:

- Un worker no se ejecuta en ningún workspace. El DTO de la columna borrada lleva su
  `workspaceId`, así que el caso de uso entra en él con `runInWorkspace` (como hizo
  `notifyAssignee` en el [capítulo 12](./12-failures)), y los repositorios ven las filas
  de ese workspace.
- Busca tarjetas que sigan en la columna borrada. Casi siempre no hay ninguna, y
  termina: el borrado normal pasó por `removeColumn`, que lo comprobó.
- La primera columna es ahora la primera del tablero, tras el borrado: `column.list` ya
  no muestra la borrada. Si al tablero no le queda ninguna columna, no hay a dónde llevar
  las tarjetas, y las deja.
- Las tarjetas van al final de esa columna, en su orden, con `moveTo` por `BOARDS`. Cada
  una emite `card.moved`, como cualquier movimiento.
- `persistOrder` (del [capítulo 8](./08-two-people-one-card)) las guarda, protegiendo las
  dos columnas y comprobando su orden después de escribir. Una tarjeta que alguien movió
  mientras tanto es un conflicto, y el caso de uso se ejecuta otra vez con lo que haya
  entonces.

Ejecútalo una segunda vez y no encuentra ninguna tarjeta en la columna borrada, y no hace
nada. Eso importa, porque un worker puede ejecutarlo más de una vez.

El comentario del propio módulo de columnas sobre `remove` dice lo mismo, para que quien
lo lea sepa que una tarjeta puede quedarse en la columna, y qué pasa con ella. Sustitúyelo
en `column.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /**
   * Removes a column, and the ones to its right move one place left. Whether it is
   * empty is not known here, where cards are not: `card.removeColumn` asks the cards
   * first, and is what the API calls. A card left in it anyway (moved in at that very
   * moment) is taken to another column by a worker of the cards.
   */
  @UseCase()
  async remove(id: string): Promise<void> {
```

La suscripción viene más abajo, junto a la otra, en `card.workers.ts`.

## Los eventos de auth, como un puerto

Ahora Bea. boards quiere enterarse de que alguien perdió su acceso. Ese evento es de auth,
y boards no debe importar los módulos de auth: el módulo de tarjetas dependería entonces
del código de otro contexto, y un test de boards necesitaría auth entero.

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
abre el contexto: ahora un auth falso, y luego el `access.events` real de auth desde el
[capítulo 20](./20-wiring-contexts).

## Qué eventos: `when`, con un type guard

Las dos reacciones van en `card.workers.ts`. Sustitúyelo:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
import type { Card_Deps, RevokedAccess } from './card.deps'
import type { Card_Module } from './card.module'

/**
 * What the cards do when something happens, each a job saved with what it reacts to,
 * run by a worker until it succeeds, and safe to run again.
 */
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them, by someone else.
  cards.events.created.subscribe(({ by, ...card }) => cards.notifyAssignee(card, by), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
    when: card => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), {
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
  // For now the product is named here: auth's WORKSPACES_PRODUCT (chapter 17) takes its place.
  deps.access.revoked.subscribe(access => cards.unassignMember(access.tenantId, access.userId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
    when: (access: RevokedAccess): access is RevokedAccess & { tenantId: string } => access.productId === 'cooper' && access.tenantId !== null,
  })
}
```

La primera suscripción nueva es la de la columna. Es un `handler`, como el email del
capítulo 12: un job guardado con el borrado, en la misma transacción, y ejecutado hasta
que se completa. Su cola sigue la regla de nombres: `card.leaveRemovedColumn`, el módulo
y el caso de uso que reaccionan, `.on.column.removed`, el evento.

La segunda es la de auth. auth cuenta todos los accesos que quita, a cualquier producto,
y boards solo quiere los de un workspace de cooper. Conociste `when` en el capítulo 12,
donde el email de una tarjeta nueva solo se envía si tiene asignado. Aquí hace un segundo
trabajo.

- **Decide qué eventos reciben un job.** `when` se ejecuta en la transacción del guardado
  que emite el evento, antes de escribir ningún job. Un evento que no acepta no deja
  ningún job: un miembro del personal que pierde el backoffice no escribe nada para
  boards. Solo mira el payload; si el evento importa o no es cosa de `when`, nunca de la
  lógica de negocio del caso de uso.
- **Escrito como un type guard, acota lo que recibe el callback.** El payload dice
  `tenantId: string | null`, y `unassignMember` recibe un `string`. El guard
  `(access: RevokedAccess): access is RevokedAccess & { tenantId: string }` le dice a
  TypeScript que todo lo que pasa tiene tenant, así que el callback puede pasar
  `access.tenantId` directamente al caso de uso. Un `when` que devolviera un booleano
  normal filtraría los mismos eventos, pero el callback seguiría viendo `string | null`, y
  la llamada no compilaría. Tipa el parámetro, como aquí, para que el guard funcione.

Por ahora el nombre del producto está escrito aquí como `'cooper'`. auth lo nombra con
una constante, `WORKSPACES_PRODUCT`, que aquí no se puede usar hasta el capítulo 20; entonces
sustituirá al string.

## Dejar las tarjetas sin asignado

Añade `unassignMember` a `card.module.ts`, después de `notifyAssignee`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Someone lost their access to a workspace: its cards they had are left without an
   * assignee. What a worker calls, reacting to auth; the second time, they have none.
   */
  @UseCase()
  async unassignMember(workspaceId: string, userId: string): Promise<void> {
    await runInWorkspace(workspaceId, async () => {
      const cards = await this.repo.find({ assigneeId: userId })
      for (const card of cards) card.unassign(BOARDS)
      await this.repo.persist(...cards)
    })
  }
```

Entra en el workspace que nombró el evento, busca las tarjetas asignadas a esa persona,
desasigna cada una por `BOARDS`, y las guarda todas en un solo guardado. Cada tarjeta
emite `card.unassigned`, así que el registro de actividad lo anota, sin actor. La segunda
ejecución no encuentra ninguna tarjeta suya, no guarda nada, y termina.

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

Aquí ninguna de las dos reacciones cruza siquiera a otro módulo: cada una es un caso de
uso del módulo de tarjetas que escribe las filas del módulo de tarjetas. El
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
import { Email, eventsOf, type DomainEvent } from 'newt/core'
import { Base } from 'newt/runtime'
import type { AccessEvents } from '../modules/card/card.deps'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'

type Access = { userId: string, productId: string, tenantId: string | null }

class Access_Revoked implements DomainEvent<Access> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = new Date().toISOString()
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
  `eventName` estático, el `name`, cuándo ocurrió y el payload.
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
    mailer: { send: async mail => { mails.push(mail) } },
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

En `card.test.ts`, después del test del email a nadie, la columna borrada. El test llama
a `column.remove` directamente, saltándose la comprobación de `removeColumn`, que es
justo lo que hace la carrera:

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
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

Los dos tests nuevos por separado:

```sh
bun test cooper -t 'credits nobody|removed column'
```

```text
 2 pass
 41 filtered out
 0 fail
 2 expect() calls
Ran 2 tests across 6 files.
```

## En resumen

- Lo que un módulo necesita de otro contexto es un puerto en sus propias deps, con sus
  propias palabras. Para eventos, un `EventSource<T>`: solo `subscribe`. El emisor del
  otro contexto encaja; un test entrega el suyo.
- `when` elige qué eventos reciben un job, en la transacción que los emite, así que un
  evento que no acepta no deja nada. Escrito como un type guard con el parámetro tipado,
  acota lo que recibe el callback.
- Solo un worker escribe en otro módulo. Una consecuencia en los datos de otro es un
  evento emitido y una reacción desde un worker, nunca una escritura directa.
- Lo que boards hace por su cuenta lo hace nadie: `{ by: null, via: null }`. Un worker no
  tiene actor, y entra en el workspace que nombra el evento con `runInWorkspace`.
- Una reacción puede ejecutarse dos veces. Haz que la segunda no encuentre nada que hacer:
  ninguna tarjeta en la columna, ninguna tarjeta suya que siga asignada.

Siguiente: [Sagas: un workspace llega y se va](./14-sagas).
