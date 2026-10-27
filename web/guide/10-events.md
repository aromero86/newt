# Events

Ana moves card #1 from *To do* to *Doing*. Several people may care. Somebody watching
the server's log wants to see the move. Later in this part, the card's history records
it, and when a card is assigned, the assignee gets an email. In later parts, the
backoffice counts cards, and boards reacts to auth deleting a workspace.

None of that belongs in `card.move`. If the card module called the activity log, the
mailer and the backoffice, it would depend on each of them, and every new reaction
would mean changing the module that moves cards. It is the wrong way round: the card
module should **tell** what happened, and whoever cares should **listen**.

newt calls what a module tells an **event**. This chapter makes boards' three modules
tell theirs, and adds the first listener: a line in the log each time a card moves.
That listener is the kind that may lose what it hears, and the chapter ends with what
it loses. The [next chapter](./11-reacting) adds the kind that loses nothing.

## What an event is

An event is something that already happened, named in the past tense:
`board.created`, `column.renamed`, `card.moved`. The module that tells it does not
know who listens, or whether anyone does.

newt's type for it is `DomainEvent`, from `newt/core`: a `name`, a `payload` and when
it happened, `occurredAt`. (It also has an `id`, which the publisher gives it; the
[next chapter](./11-reacting) uses it.) In cooper each event is a small class in its
module's `events` folder. This is the first one:

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

- `eventName` is static, so a module can say which events it tells without making one
  (below). `name` is the same string on each event.
- `occurredAt` is `now()`, from `newt/core`, not `new Date()`: the time by the clock
  of the context at work. Until chapter [19](./19-invitations-and-time) that clock is
  the real one, so it is the same thing; there a context gets a clock of its own, and
  a test that moves it sees its events at that time too.
- The name is `<module>.<what happened>`. The class is `<Module>_<Verb>`, in the file
  `events/<module>-<verb>.ts`.
- The payload is plain data, never an entity: here the board's DTO. newt types it as
  `Json`, since the [next chapter](./11-reacting) writes it to the database and reads
  it back later, maybe with a newer version of the code. A date travels as its ISO
  string. A payload's type is a `type`, not an `interface`: TypeScript does not take an
  interface as JSON.

## The board tells

A board is created, updated and archived. Two more classes, in the same folder:

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

A `created` or an `archived` event carries the DTO. An event about a change carries
more, since a listener usually wants to know what changed:

- `dto`: the board as it is now, whole.
- `changes`: the fields that changed.
- `previous`: what those fields were before.

Each field's change is `previous[field]` → `changes[field]`. A listener that writes
"renamed from *Roadmap* to *Plan*" needs nothing else.

### The entity notes it

Who tells? The entity, in the method that makes the change. `Entity` gives every
entity **`trackEvent`**, which notes an event to be told when the entity is saved.
Here is `board.ts` with its three events:

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

- `create` builds the board, then notes `Board_Created` with its DTO.
- `update` changes what it was given, then asks the entity what actually changed:
  `getChanges()` gives the changed fields since it was loaded, or null if nothing did;
  `getPrevious()` gives what they were. Renaming a board to the name it already has
  changes nothing, and **tells nothing**. A listener never hears of a change that did
  not happen.
- `archive` marks it deleted (soft: its row stays, chapter
  [2](./02-first-module)) and notes `Board_Archived` with the board as it was.

Nobody else calls `trackEvent`: it is `protected`. The use case does not tell, the
repository does not decide what to tell. The entity knows what changed, so it says
it.

One small change to `board.schema.ts`, a doc comment on `name`:

```ts
// cooper/backend/contexts/boards/modules/board/board.schema.ts
  workspaceId: z.string(),
  /** Its workspace's once, whatever its case. */
  name: BoardName.schema,
```

### The module offers them: `eventsOf`

A listener subscribes to an event on the module that tells it. Each module offers its
events under a field, `events`, made with **`eventsOf`** from `newt/core`: give it the
context's event bus (`base.bus`) and the event classes by a short key, and it gives one
emitter per key. In `board.module.ts`, add `eventsOf` to the import from `newt/core`
and import the three classes:

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

Then the field, set in the constructor:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  readonly events

  private constructor(base: BoardsBase, private readonly repo: Board_Repository, deps: Board_Deps) {
    super('board', base.invocations, deps)
    this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  }
```

From outside it reads as what it is, `board.events.created`, and it is typed: whoever
subscribes to it gets a `BoardDTO`.

No use case of the board module changes. `create`, `update` and `archive` already call
the entity's methods and then save it.

## The columns tell

A column is added, renamed, moved and removed. Four classes, the same shape:

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

And the entity notes them:

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

In chapter [8](./08-two-people-one-card), `moveTo` and `reposition` did the same thing
and were two methods because they meant two things. Here is the difference: the column
someone moved tells `column.moved`; the columns pushed aside only take the places left,
and tell nothing. Nobody moved them.

### One event of each kind per save

Look at `add` and `place`. `Column.add` notes `Column_Added` with the position the end
of the board looked to be. Then the repository places it for sure as it saves it
(chapter [6](./06-rules-over-rows)), and `place` notes `Column_Added` again, with the
real position. The save tells **one** `column.added`, not two:

> An entity tells at most one event of each name per save. A second one noted before
> the save replaces the first.

The last one is built from the entity as it is then, so it tells the truth: the
position the column really got. Two changes of the same kind before one save make one
event with both.

The column module offers them as the board module does. Add `eventsOf` and the four
classes to its imports:

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

and the field:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  readonly events

  private constructor(base: BoardsBase, private readonly repo: Column_Repository, private readonly deps: Column_Deps) {
    super('column', base.invocations, deps)
    this.events = eventsOf(base.bus, { added: Column_Added, renamed: Column_Renamed, moved: Column_Moved, removed: Column_Removed })
  }
```

## The cards tell, and who did it

A card's events carry one thing more: **who** did it. A listener will need it: the
history says "moved by ana", the email is not sent to someone who assigned the card
to themselves. And a listener cannot ask. It runs after the use case, with no actor
around it: `currentActor()` would throw there. Who acted is known only now, while the
use case runs, so if a listener needs it, the event carries it.

Add the type at the end of `card.schema.ts`, and import `ActorVia` from
`shared/actor.ts` (chapter [4](./04-who-and-where)):

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

`by` and `via` are null when boards does something on its own, from a worker: later
chapters have it move the cards out of a removed column (chapter
[13](./13-another-context)) and make a workspace's welcome card (chapter
[14](./14-sagas)). Today every author is a person.

Six events. Each payload is the card plus the author, shaped for what a listener needs:

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

An assignment always has someone behind it, so `Card_Assigned` narrows the author to
`{ by: string }`. `card.assigned` and `card.unassigned` carry `previousAssigneeId`,
who had the card: that is what a listener of an assignment asks first.

### The entity notes them

Each method that makes a change takes its author now, and notes its event. Here is the
whole `card.ts`:

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

- `create` keeps its author in a private field, `author`, and notes `card.created`.
  `place`, which the save calls with the real number and position (chapter
  [7](./07-cards-and-a-counter)), notes it again with the same author: one
  `card.created` per save, the last, with the number the card really got.
- `edit` and `moveTo` tell `dto`, `changes` and `previous`, only when something
  changed. A card dropped where it was tells nothing.
- `reposition` tells nothing, as the column's does.
- `assign` and `unassign` return early when there is nothing to change: assigning a
  card to the person who has it, or unassigning a card nobody has, **changes nothing
  and tells nothing**. Before this chapter both just saved the same value; now the
  early return is what keeps a listener from hearing of an assignment that did not
  happen.

### The module passes the author

The entity does not know who is acting: the module tells it. A use case a route calls
passes the person acting now. Add `currentActor` and `eventsOf` to the import from
`newt/core`, `CardAuthor` to the import from `./card`, and the six event classes; then,
after the imports, a function that reads the actor:

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

`via` is cooper's, not newt's: chapter [4](./04-who-and-where) added it to newt's
`Actor`, and every request says it (`'web'` for now).

The module offers its six events:

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

And each use case that changes a card passes `actingAuthor()` to the entity. `create`
passes it to `newCard`, which takes it and hands it to `Card.create`:

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

`edit`, `move`, `assign`, `unassign` and `delete` each change one line:

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

## When it is told

Noting an event is not telling it. The entity keeps what it noted until its
repository saves it. Then `save`, the method every repository write ends in (chapter
[6](./06-rules-over-rows)), **publishes** each saved entity's events, inside the
save's transaction. You write none of this: `persist`, `persistNew` and `persistOrder`
all end in `save`.

What publishing does depends on how each listener subscribed, but for every listener
one rule holds:

> An event is heard only once the transaction that saved it commits. If the
> transaction rolls back, the event never happened.

Think of what that rules out. A move that collides with another (chapter
[8](./08-two-people-one-card)) rolls back and runs again: its first attempt noted a
`card.moved`, and nobody ever hears it. Only the attempt that commits tells. A card
refused because the board is full tells nothing. Nobody reacts to a change that was
not saved.

Two more details of `save`. An entity that ends as it was read (moved and moved back
before the save) is not written, and tells nothing: a change undone is no change. And
an entity's events are published with the entity, so a save of several cards (a move
renumbers a column) tells the one `card.moved` of the card someone moved, and nothing
for the others.

## A first listener: a line in the log

Now someone listens. boards will keep each card's history in a module of its own,
`activity`: the card module will not know it exists. This chapter starts it with the
smallest reaction there is: as each card moves, a line in the server's log, to watch a
board live.

A module may take settings at `initialize`, in a file of its own,
`<module>-options.ts`. The activity takes where its lines go:

```ts
// cooper/backend/contexts/boards/modules/activity/activity-options.ts
/** What the context configures the activity with. */
export type Activity_Options = {
  /** Where a line about each move goes as it happens: the console when tracing, nowhere otherwise. */
  log: (line: string) => void
}
```

It depends on the card module, whose events it hears:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.deps.ts
import type { Card_Module } from '../card/card.module'

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
}
```

The module itself has no use case yet, no repository, no routes. It only registers
its reactions:

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

Today the module is only the line; the [next chapter](./11-reacting) gives it a
history of each card, and a comment to match. A module's reactions live in
`<module>.workers.ts`, a function its `initialize` calls:

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

A module reacts to an event by subscribing to it on the module that tells it:

```text
<module>.events.<event>.subscribe(callback, subscription)
```

- The callback gets the event's payload, typed: here `{ dto, changes, previous, by,
  via }`, of which it takes four.
- The subscription says **how** it hears the event, its `strategy`. There is no
  default: you choose each time, on purpose.

This one is **`fire-and-forget`**: newt runs the callback in memory, in this process,
right after the transaction that told the event commits. No job, nothing written,
nothing to wait for.

### What fire-and-forget loses

It is the simplest strategy, and it gives few guarantees. The callback is lost:

- **if it throws.** newt writes the error to the console (`[EventBus] handler error
  for 'card.moved': …`) and that is all. Nobody runs it again, and the request that
  moved the card never knows: it answered already.
- **if the process stops** between the commit and the callback: a deploy, a crash. The
  move is saved; the line is never written.
- **in every other process.** The bus is in memory: only the process that saved the
  move hears it. With two servers, each one hears its own moves.

It also runs with no actor, like every listener: that is why the line reads `by` from
the payload instead of `currentActor()`.

For a log line, all of that is fine. It is there to watch, not to keep: no one needs
yesterday's line, and nothing is wrong without it. That is the test for
`fire-and-forget`: **would anything be wrong if this reaction never ran?** A line in a
log, a cache cleared, a metric: no. A card's history with a hole, an email that never
leaves, boards keeping a workspace auth deleted: yes. Those need the strategy that
loses nothing, the [next chapter](./11-reacting)'s.

## Wiring it

The context's modules get where the log goes as a dependency of their own,
`log`, optional: a context opened without it logs nowhere. In
`initialize-modules.ts`, import the activity module, add `log` to
`Boards_ModuleDeps`, and initialize the activity after the cards:

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

The activity comes last: it depends on the cards. It has no routes yet, but it is
returned with the others all the same, so `boards.modules.activity` is there.

A test wants to read the lines. `openTestBoards` keeps them in a list, `lines`:

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

And the backend writes them to the console. In `index.ts`, pass `log` to
`Boards_Context.open`:

```ts
// cooper/backend/index.ts
// For now each card's move is a line on the console (chapter 28 writes it only while tracing).
const boards = await Boards_Context.open(config.boards, { workspaces: auth.workspaces, log: line => console.log(line) })
```

As the comment says, this is for now: chapter [28](./28-observability) writes the
line only while tracing.

## Test

The activity's first test, `activity.test.ts`, in its module's folder:

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

It moves a card as ana, through MCP this time (`as` takes how she came in), and reads
the line as soon as `move` returns. Nothing to wait for: the callback ran right after
the commit, in this process.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

Then by hand. Start the backend (`bun cooper/backend/index.ts`), and in another
terminal make a board with two columns and a card, and move the card:

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

The backend's console shows the move as it commits:

```text
[boards] #1 "Plan" moved from column 01a17957-6c5a-735b-be72-2543b3582dff to 01a17957-6c63-717d-ba71-196ae9e2fdd1 by ana (web)
```

with your columns' ids. Move it to the column it is in already, and nothing is
written: nothing changed, so nothing was told.

## What to remember

- An event is something that happened, `<module>.<verb in past tense>`, a class in
  `events/` with a static `eventName` and a JSON payload: the DTO, or `{ dto, changes,
  previous }` for a change, or what its listeners need.
- The entity notes it with `trackEvent`, in the method that makes the change, and only
  if something changed. One event of each name per save: the last one noted.
- Whatever a listener needs that only the moment knows (who acted) goes in the
  payload: a listener has no actor.
- A module offers its events with `eventsOf(base.bus, { … })` under `events`; others
  subscribe there, always saying how.
- The repository's save publishes them: they are heard only once it commits.
  `fire-and-forget` runs in memory after the commit, and is lost if it throws or the
  process stops. Use it only for what may be lost.

Next: [Reacting: handlers and the outbox](./11-reacting).
