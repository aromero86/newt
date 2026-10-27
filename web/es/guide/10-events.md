# Eventos

Ana mueve la tarjeta #1 de *To do* a *Doing*. Varias personas pueden tener interés.
Alguien que mira el log del servidor quiere ver el movimiento. Más adelante en esta
parte, el historial de la tarjeta lo registra, y cuando se asigna una tarjeta, la
persona asignada recibe un email. En partes posteriores, el backoffice cuenta tarjetas,
y boards reacciona a que auth borre un workspace.

Nada de eso pertenece a `card.move`. Si el módulo de tarjetas llamara al log de
actividad, al mailer y al backoffice, dependería de cada uno de ellos, y cada reacción
nueva obligaría a cambiar el módulo que mueve tarjetas. Es al revés de como debe ser: el
módulo de tarjetas debe **contar** lo que ha pasado, y quien tenga interés debe
**escuchar**.

newt llama **evento** a lo que un módulo cuenta. Este capítulo hace que los tres módulos
de boards cuenten el suyo, y añade el primer oyente: una línea en el log cada vez que se
mueve una tarjeta. Ese oyente es de los que pueden perder lo que oyen, y el capítulo
termina con lo que pierde. El [capítulo siguiente](./11-reacting) añade el que no pierde
nada.

## Qué es un evento

Un evento es algo que ya ha pasado, nombrado en pasado: `board.created`,
`column.renamed`, `card.moved`. El módulo que lo cuenta no sabe quién lo escucha, ni si
lo escucha alguien.

El tipo de newt para esto es `DomainEvent`, de `newt/core`: un `name`, un `payload` y
cuándo ocurrió, `occurredAt`. (También tiene un `id`, que le da quien lo publica; el
[capítulo siguiente](./11-reacting) lo usa.) En cooper cada evento es una clase pequeña
en la carpeta `events` de su módulo. Este es el primero:

```ts
// cooper/backend/contexts/boards/modules/board/events/board-created.ts
import { now, type DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

export class Board_Created implements DomainEvent<BoardDTO> {
  static readonly eventName = 'board.created'
  readonly name = Board_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: BoardDTO) {}
}
```

- `eventName` es estático, para que un módulo pueda decir qué eventos cuenta sin crear
  ninguno (más abajo). `name` es la misma cadena en cada evento.
- `occurredAt` es `now()`, de `newt/core`, no `new Date()`: la hora según el reloj del
  contexto en marcha. Hasta el capítulo [19](./19-invitations-and-time) ese reloj es el
  real, así que da lo mismo; allí un contexto recibe un reloj propio, y un test que lo
  mueve ve también sus eventos a esa hora.
- El nombre es `<módulo>.<qué pasó>`. La clase es `<Módulo>_<Verbo>`, en el archivo
  `events/<módulo>-<verbo>.ts`.
- El payload son datos planos, nunca una entidad: aquí el DTO del tablero. newt lo tipa
  como `Json`, porque el [capítulo siguiente](./11-reacting) lo escribe en la base de
  datos y lo lee más tarde, quizá con una versión más nueva del código. Una fecha viaja
  como su cadena ISO. El tipo de un payload es un `type`, no una `interface`:
  TypeScript no acepta una interfaz como JSON.

## El tablero cuenta

Un tablero se crea, se actualiza y se archiva. Dos clases más, en la misma carpeta:

```ts
// cooper/backend/contexts/boards/modules/board/events/board-updated.ts
import { now, type DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

/** The whole board as it is now, the fields that changed (`changes`) and what they were (`previous`). */
type BoardChange = { dto: BoardDTO, changes: Partial<BoardDTO>, previous: Partial<BoardDTO> }

export class Board_Updated implements DomainEvent<BoardChange> {
  static readonly eventName = 'board.updated'
  readonly name = Board_Updated.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: BoardChange) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/board/events/board-archived.ts
import { now, type DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

/** The board as it was when it was archived: it is kept, out of every list. */
export class Board_Archived implements DomainEvent<BoardDTO> {
  static readonly eventName = 'board.archived'
  readonly name = Board_Archived.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: BoardDTO) {}
}
```

Un evento `created` o `archived` lleva el DTO. Un evento sobre un cambio lleva más,
porque un oyente suele querer saber qué cambió:

- `dto`: el tablero como está ahora, entero.
- `changes`: los campos que cambiaron.
- `previous`: lo que eran esos campos antes.

El cambio de cada campo es `previous[field]` → `changes[field]`. Un oyente que escriba
"renombrado de *Roadmap* a *Plan*" no necesita nada más.

### La entidad lo anota

¿Quién cuenta? La entidad, en el método que hace el cambio. `Entity` da a cada entidad
**`trackEvent`**, que anota un evento para contarlo cuando se guarde la entidad. Aquí
está `board.ts` con sus tres eventos:

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
import { Entity, type EntityInput } from 'newt/core'
import { BoardSchema, type BoardDTO } from './board.schema'
import { Board_Archived } from './events/board-archived'
import { Board_Created } from './events/board-created'
import { Board_Updated } from './events/board-updated'
import { BoardName } from './value-objects/board-name'

export * from './board.schema'

/** A workspace's board: its columns and cards are other modules', which point at it. */
export class Board extends Entity<typeof BoardSchema> {

  private constructor(input: EntityInput<BoardDTO>, isNew: boolean) {
    super(BoardSchema, input, isNew)
  }

  static fromDTO(dto: BoardDTO & { version: number }): Board {
    return new Board(dto, false)
  }

  /** A new one, in its workspace: the name as someone typed it becomes a `BoardName`. */
  static create(input: { workspaceId: string, name: string, description: string }): Board {
    const board = new Board({ ...input, name: BoardName.from(input.name) }, true)
    board.trackEvent(new Board_Created(board.toDTO()))
    return board
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get name(): BoardName {
    return this.data.name
  }

  update(changes: { name?: string, description?: string }): void {
    this.change({
      ...(changes.name === undefined ? {} : { name: BoardName.from(changes.name) }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
    })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Board_Updated({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Out of every list, its name free again; its row stays, with what points at it. */
  archive(): void {
    this.markAsDeleted()
    this.trackEvent(new Board_Archived(this.toDTO()))
  }
}
```

- `create` construye el tablero y anota `Board_Created` con su DTO.
- `update` cambia lo que se le dio y luego pregunta a la entidad qué cambió de verdad:
  `getChanges()` da los campos cambiados desde que se cargó, o null si no cambió nada;
  `getPrevious()` da lo que eran. Renombrar un tablero con el nombre que ya tiene no
  cambia nada, y **no cuenta nada**. Un oyente nunca se entera de un cambio que no
  ocurrió.
- `archive` lo marca como borrado (borrado lógico: su fila se queda, capítulo
  [2](./02-first-module)) y anota `Board_Archived` con el tablero como era.

Nadie más llama a `trackEvent`: es `protected`. El caso de uso no cuenta, el
repositorio no decide qué contar. La entidad sabe qué cambió, así que lo dice.

Un cambio pequeño en `board.schema.ts`, un comentario de documentación en `name`:

```ts
// cooper/backend/contexts/boards/modules/board/board.schema.ts
  workspaceId: z.string(),
  /** Its workspace's once, whatever its case. */
  name: BoardName.schema,
```

### El módulo los ofrece: `eventsOf`

Un oyente se suscribe a un evento en el módulo que lo cuenta. Cada módulo ofrece sus
eventos bajo un campo, `events`, hecho con **`eventsOf`** de `newt/core`: dale el bus de
eventos del contexto (`base.bus`) y las clases de eventos con una clave corta, y te da
un emisor por clave. En `board.module.ts`, añade `eventsOf` al import de `newt/core` e
importa las tres clases:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import { eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
// …
import { BoardNotFound } from './errors/board-not-found'
import { Board_Archived } from './events/board-archived'
import { Board_Created } from './events/board-created'
import { Board_Updated } from './events/board-updated'
import { BoardName } from './value-objects/board-name'
```

Luego el campo, en el constructor:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  readonly events

  private constructor(base: BoardsBase, private readonly repo: Board_Repository, deps: Board_Deps) {
    super('board', base.invocations, deps)
    this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  }
```

Desde fuera se lee como lo que es, `board.events.created`, y está tipado: quien se
suscriba a él recibe un `BoardDTO`.

Ningún caso de uso del módulo de tableros cambia. `create`, `update` y `archive` ya
llaman a los métodos de la entidad y luego la guardan.

## Las columnas cuentan

Una columna se añade, se renombra, se mueve y se quita. Cuatro clases, de la misma forma:

```ts
// cooper/backend/contexts/boards/modules/column/events/column-added.ts
import { now, type DomainEvent } from 'newt/core'
import type { ColumnDTO } from '../column.schema'

export class Column_Added implements DomainEvent<ColumnDTO> {
  static readonly eventName = 'column.added'
  readonly name = Column_Added.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnDTO) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/column/events/column-renamed.ts
import { now, type DomainEvent } from 'newt/core'
import type { ColumnDTO } from '../column.schema'

/** The column as it is now, and the name it had (`previous`). */
type ColumnRename = { dto: ColumnDTO, changes: Partial<ColumnDTO>, previous: Partial<ColumnDTO> }

export class Column_Renamed implements DomainEvent<ColumnRename> {
  static readonly eventName = 'column.renamed'
  readonly name = Column_Renamed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnRename) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/column/events/column-moved.ts
import { now, type DomainEvent } from 'newt/core'
import type { ColumnDTO } from '../column.schema'

/**
 * The column someone moved, where it is now and where it was (`previous`). The
 * columns it pushed aside tell nothing: they only took the places left.
 */
type ColumnMove = { dto: ColumnDTO, changes: Partial<ColumnDTO>, previous: Partial<ColumnDTO> }

export class Column_Moved implements DomainEvent<ColumnMove> {
  static readonly eventName = 'column.moved'
  readonly name = Column_Moved.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnMove) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/column/events/column-removed.ts
import { now, type DomainEvent } from 'newt/core'
import type { ColumnDTO } from '../column.schema'

/** The column as it was when it was removed. */
export class Column_Removed implements DomainEvent<ColumnDTO> {
  static readonly eventName = 'column.removed'
  readonly name = Column_Removed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnDTO) {}
}
```

Y la entidad las anota:

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
import { Entity, type EntityInput } from 'newt/core'
import { ColumnSchema, type ColumnDTO } from './column.schema'
import { Column_Added } from './events/column-added'
import { Column_Moved } from './events/column-moved'
import { Column_Removed } from './events/column-removed'
import { Column_Renamed } from './events/column-renamed'

export * from './column.schema'

/** A column of a board. */
export class Column extends Entity<typeof ColumnSchema> {

  private constructor(input: EntityInput<ColumnDTO>, isNew: boolean) {
    super(ColumnSchema, input, isNew)
  }

  static fromDTO(dto: ColumnDTO & { version: number }): Column {
    return new Column(dto, false)
  }

  /** A new one, at the end of its board: `position` is where the end looked to be, and its save places it for sure. */
  static add(input: { workspaceId: string, boardId: string, name: string, position: number }): Column {
    const column = new Column(input, true)
    column.trackEvent(new Column_Added(column.toDTO()))
    return column
  }

  get boardId(): string {
    return this.data.boardId
  }

  get name(): string {
    return this.data.name
  }

  get position(): number {
    return this.data.position
  }

  /** A new one takes its place as it is saved: the end of its board, read where no other column can be added in between. */
  place(position: number): void {
    if (!this.isNew) throw new Error(`Column ${this.id} is placed once, as it is added`)
    this.change({ position })
    this.trackEvent(new Column_Added(this.toDTO()))
  }

  rename(name: string): void {
    this.change({ name })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Column_Renamed({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Someone moved it: where it goes. */
  moveTo(position: number): void {
    this.change({ position })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Column_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Another one moved, or left: this one takes the place left to it, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }

  remove(): void {
    this.markAsDeleted()
    this.trackEvent(new Column_Removed(this.toDTO()))
  }
}
```

En el capítulo [8](./08-two-people-one-card), `moveTo` y `reposition` hacían lo mismo y
eran dos métodos porque significaban dos cosas. Aquí está la diferencia: la columna que
alguien movió cuenta `column.moved`; las columnas desplazadas solo ocupan los sitios que
quedan, y no cuentan nada. Nadie las movió.

### Un evento de cada tipo por guardado

Mira `add` y `place`. `Column.add` anota `Column_Added` con la posición donde parecía
estar el final del tablero. Luego el repositorio la coloca de verdad al guardarla
(capítulo [6](./06-rules-over-rows)), y `place` anota `Column_Added` otra vez, con la
posición real. El guardado cuenta **un** `column.added`, no dos:

> Una entidad cuenta como mucho un evento de cada nombre por guardado. Un segundo evento
> anotado antes del guardado sustituye al primero.

El último se construye con la entidad tal como está entonces, así que dice la verdad: la
posición que la columna recibió de verdad. Dos cambios del mismo tipo antes de un
guardado hacen un solo evento con ambos.

El módulo de columnas los ofrece como el de tableros. Añade `eventsOf` y las cuatro
clases a sus imports:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
import { eventsOf, Module, UseCase } from 'newt/core'
// …
import { TooManyColumns } from './errors/too-many-columns'
import { Column_Added } from './events/column-added'
import { Column_Moved } from './events/column-moved'
import { Column_Removed } from './events/column-removed'
import { Column_Renamed } from './events/column-renamed'
```

y el campo:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  readonly events

  private constructor(base: BoardsBase, private readonly repo: Column_Repository, private readonly deps: Column_Deps) {
    super('column', base.invocations, deps)
    this.events = eventsOf(base.bus, { added: Column_Added, renamed: Column_Renamed, moved: Column_Moved, removed: Column_Removed })
  }
```

## Las tarjetas cuentan, y quién lo hizo

Los eventos de una tarjeta llevan una cosa más: **quién** lo hizo. Un oyente la
necesitará: el historial dice "movida por ana", y el email no se envía a quien se
asignó la tarjeta a sí mismo. Y un oyente no puede preguntarlo. Se ejecuta después del
caso de uso, sin actor a su alrededor: `currentActor()` lanzaría un error ahí. Quién
actuó solo se sabe ahora, mientras se ejecuta el caso de uso, así que si un oyente lo
necesita, el evento lo lleva.

Añade el tipo al final de `card.schema.ts`, e importa `ActorVia` de `shared/actor.ts`
(capítulo [4](./04-who-and-where)):

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
import { z } from 'zod'
import type { ActorVia } from '../../../../shared/actor'
// …
export type CardAssignDTO = z.input<typeof CardAssignSchema>

/**
 * Who does something to a card, as its events tell it: their user's id (`by`) and how
 * they came in (`via`, the web or MCP). Both null for boards' own work, which a worker
 * does with no one behind it: a workspace's welcome card, the cards a
 * removed column or a member who left leaves behind.
 */
export type CardAuthor = { by: string | null, via: ActorVia | null }
```

`by` y `via` son null cuando boards hace algo por su cuenta, desde un worker: capítulos
posteriores le hacen mover las tarjetas de una columna quitada (capítulo
[13](./13-another-context)) y crear la tarjeta de bienvenida de un workspace (capítulo
[14](./14-sagas)). Hoy todo autor es una persona.

Seis eventos. Cada payload es la tarjeta más el autor, con la forma que necesita un
oyente:

```ts
// cooper/backend/contexts/boards/modules/card/events/card-created.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The new card, with its number and its place, and who created it: nobody for boards' own work (a welcome card). */
type CardCreation = CardDTO & CardAuthor

export class Card_Created implements DomainEvent<CardCreation> {
  static readonly eventName = 'card.created'
  readonly name = Card_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardCreation) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/card/events/card-edited.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card as it is now, its title or description as they are (`changes`) and as they were (`previous`), and who edited it. */
type CardEdit = { dto: CardDTO, changes: Partial<CardDTO>, previous: Partial<CardDTO> } & CardAuthor

export class Card_Edited implements DomainEvent<CardEdit> {
  static readonly eventName = 'card.edited'
  readonly name = Card_Edited.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardEdit) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/card/events/card-moved.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/**
 * The card someone moved: its column and position now (`changes`) and before
 * (`previous`), and who moved it: nobody when its column was removed. The cards it
 * pushed aside tell nothing: they only took the places left.
 */
type CardMove = { dto: CardDTO, changes: Partial<CardDTO>, previous: Partial<CardDTO> } & CardAuthor

export class Card_Moved implements DomainEvent<CardMove> {
  static readonly eventName = 'card.moved'
  readonly name = Card_Moved.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardMove) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/card/events/card-assigned.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card, now assigned to `dto.assigneeId`, who had it before, if anyone, and who assigned it. */
type CardAssignment = { dto: CardDTO, previousAssigneeId: string | null } & CardAuthor & { by: string }

export class Card_Assigned implements DomainEvent<CardAssignment> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardAssignment) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/card/events/card-unassigned.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card, assigned to nobody now, who had it, and who took it from them: nobody when a member left the workspace. */
type CardUnassignment = { dto: CardDTO, previousAssigneeId: string } & CardAuthor

export class Card_Unassigned implements DomainEvent<CardUnassignment> {
  static readonly eventName = 'card.unassigned'
  readonly name = Card_Unassigned.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardUnassignment) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/card/events/card-deleted.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card as it was when it was deleted, and who deleted it. */
type CardDeletion = CardDTO & CardAuthor

export class Card_Deleted implements DomainEvent<CardDeletion> {
  static readonly eventName = 'card.deleted'
  readonly name = Card_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardDeletion) {}
}
```

Una asignación siempre tiene a alguien detrás, así que `Card_Assigned` estrecha el autor
a `{ by: string }`. `card.assigned` y `card.unassigned` llevan `previousAssigneeId`, quien
tenía la tarjeta: es lo primero que pregunta un oyente de una asignación.

### La entidad los anota

Cada método que hace un cambio recibe ahora a su autor y anota su evento. Aquí está el
`card.ts` entero:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
import { Entity, type EntityInput } from 'newt/core'
import { CardSchema, type CardAuthor, type CardDTO } from './card.schema'
import { Card_Assigned } from './events/card-assigned'
import { Card_Created } from './events/card-created'
import { Card_Deleted } from './events/card-deleted'
import { Card_Edited } from './events/card-edited'
import { Card_Moved } from './events/card-moved'
import { Card_Unassigned } from './events/card-unassigned'

export * from './card.schema'

/**
 * What it takes to create a card: checked, in its workspace, with the number and the
 * place it looked to get. Its save gives it the ones it really gets.
 */
export type CardOpening = {
  workspaceId: string
  boardId: string
  columnId: string
  number: number
  position: number
  title: string
  description: string
  assigneeId: string | null
}

/** A card of a board. */
export class Card extends Entity<typeof CardSchema> {

  private constructor(input: EntityInput<CardDTO>, isNew: boolean) {
    super(CardSchema, input, isNew)
  }

  static fromDTO(dto: CardDTO & { version: number }): Card {
    return new Card(dto, false)
  }

  /** Who created it: nobody for boards' own work (a workspace's welcome card). */
  private author: CardAuthor | null = null

  static create(input: CardOpening, author: CardAuthor): Card {
    const card = new Card(input, true)
    card.author = author
    card.trackEvent(new Card_Created({ ...card.toDTO(), ...author }))
    return card
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get boardId(): string {
    return this.data.boardId
  }

  get columnId(): string {
    return this.data.columnId
  }

  get position(): number {
    return this.data.position
  }

  get assigneeId(): string | null {
    return this.data.assigneeId
  }

  /**
   * A new one takes its number and its place as it is saved: the next number of its
   * board and the bottom of its column, read where no other card can take them in
   * between. What it tells says them.
   */
  place(number: number, position: number): void {
    if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
    this.change({ number, position })
    this.trackEvent(new Card_Created({ ...this.toDTO(), ...this.author! }))
  }

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

  /** Another one moved, or left: this one takes the place left to it in its column, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }

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

  delete(author: CardAuthor): void {
    this.markAsDeleted()
    this.trackEvent(new Card_Deleted({ ...this.toDTO(), ...author }))
  }
}
```

- `create` guarda a su autor en un campo privado, `author`, y anota `card.created`.
  `place`, a la que llama el guardado con el número y la posición reales (capítulo
  [7](./07-cards-and-a-counter)), lo anota otra vez con el mismo autor: un
  `card.created` por guardado, el último, con el número que la tarjeta recibió de verdad.
- `edit` y `moveTo` cuentan `dto`, `changes` y `previous`, solo cuando algo cambió. Una
  tarjeta soltada donde estaba no cuenta nada.
- `reposition` no cuenta nada, como la de la columna.
- `assign` y `unassign` vuelven pronto cuando no hay nada que cambiar: asignar una
  tarjeta a quien ya la tiene, o quitar la asignación a una tarjeta que nadie tiene,
  **no cambia nada y no cuenta nada**. Antes de este capítulo ambos guardaban el mismo
  valor sin más; ahora ese retorno anticipado es lo que evita que un oyente se entere de
  una asignación que no ocurrió.

### El módulo pasa el autor

La entidad no sabe quién actúa: se lo dice el módulo. Un caso de uso al que llama una
ruta pasa a la persona que actúa ahora. Añade `currentActor` y `eventsOf` al import de
`newt/core`, `CardAuthor` al import de `./card`, y las seis clases de eventos; luego,
después de los imports, una función que lee al actor:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { currentActor, eventsOf, Module, UseCase } from 'newt/core'
// …
  type CardAuthor,
// …
import { TooManyCards } from './errors/too-many-cards'
import { Card_Assigned } from './events/card-assigned'
import { Card_Created } from './events/card-created'
import { Card_Deleted } from './events/card-deleted'
import { Card_Edited } from './events/card-edited'
import { Card_Moved } from './events/card-moved'
import { Card_Unassigned } from './events/card-unassigned'

/** The person acting now, as a card's events tell it: a use case a route or an MCP tool called. */
function actingAuthor(): CardAuthor & { by: string } {
  const { userId, via } = currentActor()
  return { by: userId, via }
}
```

`via` es de cooper, no de newt: el capítulo [4](./04-who-and-where) lo añadió al `Actor`
de newt, y cada petición lo dice (`'web'` por ahora).

El módulo ofrece sus seis eventos:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  readonly events

  private constructor(
    base: BoardsBase,
    private readonly repo: Card_Repository,
    private readonly deps: Card_Deps,
  ) {
    super('card', base.invocations, deps)
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

Y cada caso de uso que cambia una tarjeta pasa `actingAuthor()` a la entidad. `create`
se lo pasa a `newCard`, que lo recibe y se lo da a `Card.create`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  @UseCase()
  async create(boardId: string, input: unknown): Promise<CardDTO> {
    const card = await this.newCard(boardId, input, actingAuthor())
// …
  /** A new card of a board, checked: its column is the board's, its assignee a member. */
  private async newCard(boardId: string, input: unknown, author: CardAuthor): Promise<Card> {
// …
      title,
      description,
      assigneeId,
    }, author)
  }
```

`edit`, `move`, `assign`, `unassign` y `delete` cambian una línea cada uno:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
    card.edit(changes, actingAuthor())
// …
    target.forEach((each, index) => each === card ? card.moveTo(columnId, index, actingAuthor()) : each.reposition(index))
// …
    card.assign(assigneeId, actingAuthor())
// …
    card.unassign(actingAuthor())
// …
    card.delete(actingAuthor())
```

## Cuándo se cuenta

Anotar un evento no es contarlo. La entidad guarda lo que anotó hasta que su repositorio
la guarda. Entonces `save`, el método con el que acaba toda escritura de un repositorio
(capítulo [6](./06-rules-over-rows)), **publica** los eventos de cada entidad guardada,
dentro de la transacción del guardado. Tú no escribes nada de esto: `persist`,
`persistNew` y `persistOrder` acaban todos en `save`.

Lo que hace publicar depende de cómo se suscribió cada oyente, pero para todos vale una
regla:

> Un evento se oye solo cuando la transacción que lo guardó confirma. Si la transacción
> se deshace, el evento nunca ocurrió.

Piensa en lo que eso descarta. Un movimiento que choca con otro (capítulo
[8](./08-two-people-one-card)) se deshace y se ejecuta otra vez: su primer intento anotó
un `card.moved`, y nadie lo oye jamás. Solo cuenta el intento que confirma. Una tarjeta
rechazada porque el tablero está lleno no cuenta nada. Nadie reacciona a un cambio que
no se guardó.

Dos detalles más de `save`. Una entidad que acaba como se leyó (movida y devuelta a su
sitio antes del guardado) no se escribe y no cuenta nada: un cambio deshecho no es un
cambio. Y los eventos de una entidad se publican con la entidad, así que el guardado de
varias tarjetas (un movimiento renumera una columna) cuenta el único `card.moved` de la
tarjeta que alguien movió, y nada por las demás.

## Un primer oyente: una línea en el log

Ahora alguien escucha. boards guardará el historial de cada tarjeta en un módulo propio,
`activity`: el módulo de tarjetas no sabrá que existe. Este capítulo lo empieza con la
reacción más pequeña que hay: cuando se mueve cada tarjeta, una línea en el log del
servidor, para ver un tablero en directo.

Un módulo puede recibir ajustes en `initialize`, en un archivo propio,
`<módulo>-options.ts`. La actividad recibe adónde van sus líneas:

```ts
// cooper/backend/contexts/boards/modules/activity/activity-options.ts
/** What the context configures the activity with. */
export type Activity_Options = {
  /** Where a line about each move goes as it happens: the console when tracing, nowhere otherwise. */
  log: (line: string) => void
}
```

Depende del módulo de tarjetas, cuyos eventos oye:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.deps.ts
import type { Card_Module } from '../card/card.module'

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
}
```

El módulo en sí aún no tiene casos de uso, ni repositorio, ni rutas. Solo registra sus
reacciones:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
import { Module } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Options } from './activity-options'
import { registerActivityWorkers } from './activity.workers'

/**
 * What happened to each card, and who did it. For now, a line in the server's log
 * as each card moves, told by the card's own event.
 */
export class Activity_Module extends Module {

  static initialize(base: BoardsBase, deps: Activity_Deps, options: Activity_Options): Activity_Module {
    const module = new Activity_Module(base, deps)
    registerActivityWorkers(module, deps, options)
    return module
  }

  private constructor(base: BoardsBase, deps: Activity_Deps) {
    super('activity', base.invocations, deps)
  }
}
```

Hoy el módulo es solo la línea; el [capítulo siguiente](./11-reacting) le da un
historial de cada tarjeta, y un comentario a juego. Las reacciones de un módulo viven en
`<módulo>.workers.ts`, una función a la que llama su `initialize`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.workers.ts
import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'
import type { Activity_Options } from './activity-options'

/** What the activity does when something happens to a card. */
export function registerActivityWorkers(activity: Activity_Module, deps: Activity_Deps, options: Activity_Options): void {
  const { events } = deps.card

  // A line in the server's log as each card moves, to watch a board live while
  // tracing. `fire-and-forget`: in memory, after the commit, with no job. If it fails,
  // or the server stops before it runs, the line is lost, and nothing is wrong: no
  // one needs it later.
  events.moved.subscribe(({ dto, previous, by, via }) => {
    options.log(`[boards] #${dto.number} "${dto.title}" moved from column ${previous.columnId} to ${dto.columnId} by ${by ?? 'cooper'}${via ? ` (${via})` : ''}`)
  }, { strategy: 'fire-and-forget' })
}
```

Un módulo reacciona a un evento suscribiéndose a él en el módulo que lo cuenta:

```text
<módulo>.events.<evento>.subscribe(callback, subscription)
```

- El callback recibe el payload del evento, tipado: aquí `{ dto, changes, previous, by,
  via }`, de los que toma cuatro.
- La suscripción dice **cómo** oye el evento, su `strategy`. No hay valor por defecto: lo
  eliges cada vez, a propósito.

Esta es **`fire-and-forget`**: newt ejecuta el callback en memoria, en este proceso,
justo después de que confirme la transacción que contó el evento. Sin job, sin nada
escrito, sin nada que esperar.

### Lo que pierde fire-and-forget

Es la estrategia más simple, y da pocas garantías. El callback se pierde:

- **si lanza un error.** newt escribe el error en la consola (`[EventBus] handler error
  for 'card.moved': …`) y nada más. Nadie lo ejecuta otra vez, y la petición que movió
  la tarjeta nunca se entera: ya respondió.
- **si el proceso se detiene** entre la confirmación y el callback: un despliegue, un
  fallo. El movimiento está guardado; la línea no se escribe nunca.
- **en cualquier otro proceso.** El bus está en memoria: solo lo oye el proceso que
  guardó el movimiento. Con dos servidores, cada uno oye sus propios movimientos.

También se ejecuta sin actor, como todo oyente: por eso la línea lee `by` del payload en
vez de `currentActor()`.

Para una línea de log, todo eso está bien. Está para mirar, no para guardar: nadie
necesita la línea de ayer, y no pasa nada sin ella. Esa es la prueba de
`fire-and-forget`: **¿pasaría algo malo si esta reacción nunca se ejecutara?** Una línea
en un log, una caché vaciada, una métrica: no. Un historial de tarjeta con un hueco, un
email que nunca sale, boards conservando un workspace que auth borró: sí. Eso necesita
la estrategia que no pierde nada, la del [capítulo siguiente](./11-reacting).

## Conectarlo

Los módulos del contexto reciben adónde va el log como una dependencia propia, `log`,
opcional: un contexto abierto sin ella no registra en ningún sitio. En
`initialize-modules.ts`, importa el módulo de actividad, añade `log` a
`Boards_ModuleDeps` e inicializa la actividad después de las tarjetas:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace). Whoever opens the context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member })
  const activity = Activity_Module.initialize(base, { card }, { log: deps.log ?? (() => {}) })
  return { member, board, column, card, activity }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

La actividad va la última: depende de las tarjetas. Todavía no tiene rutas, pero se
devuelve junto a los demás igualmente, así que `boards.modules.activity` está ahí.

Un test quiere leer las líneas. `openTestBoards` las guarda en una lista, `lines`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { Boards_Context } from '../boards.context'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, its log's
 * lines in a list, and who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const lines: string[] = []
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    lines,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    async close(): Promise<void> {
      await boards.stop()
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

Y el backend las escribe en la consola. En `index.ts`, pasa `log` a
`Boards_Context.open`:

```ts
// cooper/backend/index.ts
// For now each card's move is a line on the console (chapter 28 writes it only while tracing).
const boards = await Boards_Context.open(config.boards, { workspaces: auth.workspaces, log: line => console.log(line) })
```

Como dice el comentario, esto es por ahora: el capítulo [28](./28-observability) escribe
la línea solo mientras se traza.

## Test

El primer test de la actividad, `activity.test.ts`, en la carpeta de su módulo:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

describe('activity', () => {
  let t: TestBoards
  let boardId: string
  let todo: string
  let doing: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('acme', 'bea')
    t.auth.join('globex', 'carl')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
    ;[todo, doing] = await Promise.all(['To do', 'Doing'].map(name => inAcme(() => t.modules.column.add(boardId, { name })))).then(columns => columns.map(column => column.id))
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>, via: 'web' | 'mcp' = 'web') => t.as('ana', 'acme', fn, via)

  test('writes a line as a card moves, at once, with no job to wait for', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')

    // In memory, right after the commit: no job, nothing to wait for.
    expect(t.lines).toEqual([`[boards] #${card.number} "Plan" moved from column ${todo} to ${doing} by ana (mcp)`])
  })
})
```

Mueve una tarjeta como ana, esta vez por MCP (`as` recibe cómo entró), y lee la línea
en cuanto `move` devuelve. Nada que esperar: el callback se ejecutó justo después de la
confirmación, en este proceso.

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

Luego, a mano. Arranca el backend (`bun cooper/backend/index.ts`), y en otra terminal
crea un tablero con dos columnas y una tarjeta, y mueve la tarjeta:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
post() { curl -s -X POST "$API$1" -H "$H" -H 'x-user: ana' -d "$2"; }
BOARD=$(post /boards "{\"name\":\"Events $RANDOM\"}" | jq -r .id)
TODO=$(post /boards/$BOARD/columns '{"name":"To do"}' | jq -r .id)
DOING=$(post /boards/$BOARD/columns '{"name":"Doing"}' | jq -r .id)
CARD=$(post /boards/$BOARD/cards "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" | jq -r .id)
post /cards/$CARD/move "{\"columnId\":\"$DOING\"}" | jq -c '{number, columnId}'
```

La consola del backend muestra el movimiento cuando confirma:

```text
[boards] #1 "Plan" moved from column 01a17957-6c5a-735b-be72-2543b3582dff to 01a17957-6c63-717d-ba71-196ae9e2fdd1 by ana (web)
```

con los ids de tus columnas. Muévela a la columna en la que ya está, y no se escribe
nada: nada cambió, así que nada se contó.

## En resumen

- Un evento es algo que pasó, `<módulo>.<verbo en pasado>`, una clase en `events/` con un
  `eventName` estático y un payload JSON: el DTO, o `{ dto, changes, previous }` para un
  cambio, o lo que necesiten sus oyentes.
- La entidad lo anota con `trackEvent`, en el método que hace el cambio, y solo si algo
  cambió. Un evento de cada nombre por guardado: el último que se anotó.
- Todo lo que un oyente necesita y solo el momento sabe (quién actuó) va en el payload:
  un oyente no tiene actor.
- Un módulo ofrece sus eventos con `eventsOf(base.bus, { … })` bajo `events`; los demás se
  suscriben ahí, diciendo siempre cómo.
- El guardado del repositorio los publica: se oyen solo cuando confirma. `fire-and-forget`
  se ejecuta en memoria tras la confirmación, y se pierde si lanza un error o el proceso
  se detiene. Úsalo solo para lo que puede perderse.

Siguiente: [Reaccionar: handlers y el outbox](./11-reacting).
