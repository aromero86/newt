# Your first module: boards

This chapter builds the module `board` of `boards`, file by file. It is small, but it
has every piece a module has, and every other module of cooper is written the same
way. Use it as a template.

A board belongs to a workspace. It has a name, which no other board of its workspace
has, whatever its case, and a description. When nobody needs it any more it is
archived: it leaves every list, but its row stays, because its columns and cards still
point at it.

These are the files, all inside `cooper/backend/contexts/boards/modules/board/`:

```
board/
  board.schema.ts            the contract: what goes in and what comes out
  value-objects/
    board-name.ts            a board's name, with its own rules
  board.ts                   the entity
  events/                    what can happen
    board-created.ts
    board-updated.ts
    board-archived.ts
  errors/                    what can go wrong
    board-not-found.ts
    board-name-taken.ts
    invalid-board-name.ts
  board.repository.ts        how it is kept
  board.deps.ts              the modules it uses
  board.module.ts            its use cases
  board.routes.ts            its HTTP API
  board.test.ts              its tests
```

## 1. The contract

Everything starts by describing the data with `zod`. This file is the module's
**public contract**: what goes into its use cases and what comes out of them. It is
also the only file of the backend that the frontends' API clients may import.

```ts
// cooper/backend/contexts/boards/modules/board/board.schema.ts
import { z } from 'zod'
import { BoardName } from './value-objects/board-name'

export const BoardSchema = z.object({
  id: z.uuidv7(),
  /** The workspace it is in: an auth tenant, by id. */
  workspaceId: z.string(),
  /** Its workspace's once, whatever its case. */
  name: BoardName.schema,
  description: z.string().max(500),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** As someone types it: the name is made a `BoardName` by the board itself. */
export const BoardCreateSchema = z.object({
  name: z.string(),
  description: z.string().trim().pipe(BoardSchema.shape.description).default(''),
})
export const BoardUpdateSchema = z.object({
  name: BoardCreateSchema.shape.name,
  description: z.string().trim().pipe(BoardSchema.shape.description),
}).partial()

export type BoardDTO = z.infer<typeof BoardSchema>
export type BoardCreateDTO = z.input<typeof BoardCreateSchema>
export type BoardUpdateDTO = z.input<typeof BoardUpdateSchema>
```

- **`BoardSchema`** is the whole board. Its type, `BoardDTO`, is what other modules
  and the API see: a *DTO* (data transfer object), plain data with no behaviour.
- The **input** schemas (`Create`, `Update`) have only what a client may send. Nobody
  sends an `id`, a `workspaceId` or dates: the system sets them. The workspace, in
  particular, comes from where the request is (chapter [5](./05-who-and-where)), never
  from its body.
- Input schemas reuse the rules of the whole one: the description is trimmed, then
  `pipe`d into `BoardSchema.shape.description`, so "at most 500 characters" is written
  once. The name is taken as a plain string: the value object below decides what a
  name is.
- `workspaceId` is another context's thing (an `auth` tenant), so the board keeps only
  its id.
- Everything the file exports starts with the entity's name (`Board…`). It reads the
  same from anywhere.

## 2. A value with rules: `BoardName`

Some values have rules of their own. An email is kept in lower case and without
spaces. A board's name is trimmed, has one space between words, and has 1 to 60
characters, so ` Road  map ` and `Road map` are the same name. A **value object**
keeps those rules in one place: a type and a constant with the same name.

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
import type { ValueObject } from 'newt/core'
import { z } from 'zod'
import { InvalidBoardName } from '../errors/invalid-board-name'

const MAX_LENGTH = 60

/**
 * A board's name: 1 to 60 characters, without spaces around it nor two in a row, so
 * ` Road  map ` and `Road map` are one name. A string at runtime; to the compiler, only
 * one that went through `BoardName.from` or `BoardName.schema` is a `BoardName`.
 */
export type BoardName = string & z.$brand<'BoardName'>

export const BoardName = {
  /** How it is kept: what `from` makes of what someone typed. */
  schema: z.string()
    .min(1)
    .max(MAX_LENGTH)
    .refine(name => name === tidy(name), 'A board\'s name has no spaces around it, nor two in a row')
    .brand<'BoardName'>(),
  from(value: string): BoardName {
    const name = tidy(value)
    if (name.length === 0 || name.length > MAX_LENGTH) throw new InvalidBoardName(value)
    return name as BoardName
  },
} satisfies ValueObject<BoardName, string>

function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
```

It has two halves:

- **`from`** turns what someone typed into the value, or throws a validation error
  (400) that says what is wrong: `InvalidBoardName`.
- **`schema`** describes how the value is **kept**. It is strict: it does not tidy
  anything, it refuses a name that is not tidy already. It goes in the entity's schema.

`satisfies ValueObject<BoardName, string>` checks that the constant has both halves
with the right types.

### The brand: the compiler looks after you

At runtime a `BoardName` is a `string`. To TypeScript, a plain `string` is **not** a
`BoardName` until it goes through `BoardName.from` or `BoardName.schema`. That is
called a *brand*. It makes it impossible to keep an untidy name by mistake: a field
typed `BoardName` cannot receive one.

newt ships two value objects of its own, built the same way: `Email` and
`SecretToken`. `auth` keeps every email as an `Email`, and the brand travels: a mail
cannot go to an address that was never checked, because the mailer asks for an
`Email`:

```ts
// cooper/backend/shared/mail/mailer.ts
import type { Email } from 'newt/core'

/** One email: plain text, which every reader shows. */
export type Mail = {
  to: Email
  subject: string
  text: string
}
```

### Where `from` is applied

The input schema accepts the name as the person writes it (`z.string()`). The entity
applies `BoardName.from` when it is created or renamed, as you will see next. That way
every path that creates or renames a board (a route, an MCP tool, a worker, the seed)
goes through the same rule.

A value object that only one module uses lives in that module's `value-objects/`
folder. One that several modules share lives in the application (`cooper/backend/shared`)
or, like `Email`, in the framework.

## 3. The entity

The entity is the schema **plus its behaviour**. It keeps valid data, knows what has
changed, and notes what has happened.

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

The ideas behind it:

- **Two doors in.** `create` for something new; `fromDTO` for something read from the
  store: the row, which carries its `version`, and without it the entity cannot be
  built (when it is saved, the version tells whether someone changed it in between).
  Whether an entity is new is decided by the door it comes through, never by whether
  it has an `id`. The constructor is private: there is no third door.
- **It gets its id and dates on its own.** `create` does not pass an `id`, a
  `createdAt` or an `updatedAt`: the entity gives itself a UUIDv7 and the dates.
- **Only the entity changes itself.** `change()` is protected: from outside it cannot
  be called. A use case calls `update()` or `archive()`, methods with business names.
  `change()` validates the whole entity against its schema (its `refine`s too), keeps
  the values the schema returns, and ignores what does not really change.
- **It knows what changes.** `getChanges()` gives the fields that changed, as they are
  now; `getPrevious()`, those same fields as they were when it was read. Together they
  are the transition the save will make.
- **It notes what happens.** `trackEvent` notes an event. It is not published yet: it
  will be when the entity is saved, and only if the save succeeds (chapter
  [10](./10-events)).
- **Archiving is a deletion the repository softens.** `markAsDeleted()` says the
  entity is gone; the repository, configured with `softDelete`, keeps the row and
  stamps `deletedAt` instead of removing it. A deleted entity cannot be changed again.
- **Outside its module, an entity does not exist.** Use cases return `toDTO()`, never
  the entity. Read-only getters (`workspaceId`, `name`) are for the module's own code.
- **It has a version**, which starts at 0 and goes up with each save that writes it.
  Never touch it: it is what protects two people from overwriting each other (chapter
  [7](./07-concurrency)).

### Its methods take business data, not the input DTO

`create` does not take a `BoardCreateDTO`. They look alike, but they are not:

- The **input DTO** is the API's contract: what a client sends, *before* it is
  checked. It may have extra fields, untrimmed text, things that do not exist.
- What the entity takes is what it **needs to be born**, already checked and often
  **completed** by the use case.

Here the difference is `workspaceId`. The client never sends it, and must not be able
to choose it: the use case takes it from the workspace the request is in. The
convention is simple: when the input is small, it is written inline, as in
`Board.create`; when it deserves a name, it is a type with a business name in the
entity's file, never with a `DTO` suffix and never in the schema file, which is the
API's contract.

## 4. The events

An event is a small class with a name and a *payload* (what it tells):

```ts
// cooper/backend/contexts/boards/modules/board/events/board-created.ts
import type { DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

export class Board_Created implements DomainEvent<BoardDTO> {
  static readonly eventName = 'board.created'
  readonly name = Board_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BoardDTO) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/board/events/board-updated.ts
import type { DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

/** The whole board as it is now, the fields that changed (`changes`) and what they were (`previous`). */
type BoardChange = { dto: BoardDTO, changes: Partial<BoardDTO>, previous: Partial<BoardDTO> }

export class Board_Updated implements DomainEvent<BoardChange> {
  static readonly eventName = 'board.updated'
  readonly name = Board_Updated.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BoardChange) {}
}
```

`board-archived.ts` is like `board-created.ts`, with `'board.archived'`.

- The name has the shape `<module>.<verb in the past>`.
- The payload is JSON: a worker receives it from a saved job, so a date travels as its
  ISO text, never as a `Date`. That is also why `BoardChange` is a `type` and not an
  `interface`, which TypeScript does not accept as JSON.
- An `updated` tells the whole **transition**: `dto`, the board as it is now;
  `changes`, only the fields that changed, with their new value; `previous`, those same
  fields with the value they had. Renaming `Roadmap` to `Plans` tells
  `changes: { name: 'Plans' }` and `previous: { name: 'Roadmap' }`. Whoever listens
  does not have to ask again, and can ignore the changes it does not care about.

Chapter [10](./10-events) covers when an event is published, and why each kind is told
only once per save.

## 5. The errors

Each thing that can go wrong is a class with a stable `code`. The class it extends
decides the HTTP status:

```ts
// cooper/backend/contexts/boards/modules/board/errors/board-not-found.ts
import { NotFoundError } from 'newt/core'

export class BoardNotFound extends NotFoundError {
  readonly code = 'board.not_found'
  constructor(id: string) {
    super(`There is no board ${id}`)
  }
}
```

```ts
// cooper/backend/contexts/boards/modules/board/errors/board-name-taken.ts
import { ConflictError } from 'newt/core'

export class BoardNameTaken extends ConflictError {
  readonly code = 'board.name_taken'
  constructor(name: string) {
    super(`There is a board called ${name} in this workspace already`)
  }
}
```

```ts
// cooper/backend/contexts/boards/modules/board/errors/invalid-board-name.ts
import { ValidationError } from 'newt/core'

export class InvalidBoardName extends ValidationError {
  readonly code = 'board.invalid_name'
  constructor(value: string) {
    super(`'${value}' is not a board's name: it has 1 to 60 characters`)
  }
}
```

The errors of a module live in its `errors/` folder, one per file. The `code` is
`<module>.<what>`, and it never changes: the client's code decides what to do from it.
The message is for a person to read. These are the bases newt gives you:

| Base | HTTP | When |
|---|---|---|
| `NotFoundError` | 404 | What is asked for does not exist. |
| `ValidationError` | 400 | The input is wrong. |
| `ReferenceNotFound` | 400 | An id **inside** the input points at nothing. |
| `UnauthorizedError` | 401 | Nobody is signed in. |
| `ForbiddenError` | 403 | Someone is signed in, but may not do it. |
| `ConflictError` | 409 | The current state does not allow it. |
| `ConcurrencyConflict` | 409 | Someone saved it in the meantime. |

Under `/api` the client always gets `{ error, code }` (and, when the body did not pass
the schema, its `issues`).

### The framework's messages, in your words

The framework's own errors (`not_signed_in`, `validation`, `concurrency_conflict`…)
have plain English messages: right, but written for a developer. An application
replaces them **once, at startup**, with `setMessages` from `newt/core`, to speak to
the person using it, or to speak another language. cooper keeps English and changes
the tone:

```ts
// cooper/backend/shared/messages.ts
import { setMessages, type Messages } from 'newt/core'

/**
 * What cooper says when something newt owns goes wrong, in cooper's words: newt's
 * defaults are plain and right, these speak to the person using the app. Its own
 * errors' messages each module writes itself (`errors/`); the `code` a client acts
 * on never changes (ch. 22.2).
 */
export const cooperMessages: Partial<Messages> = {
  concurrency_conflict: () => 'Someone else changed this a moment ago. Reload it and try again.',
  reference_not_found: ({ resource, id }) => `That ${resource} is not there any more (${id})`,
  not_signed_in: () => 'Your session has ended: sign in again to go on',
  validation: () => 'Some of what was sent is not right: check the fields and try again',
  route_not_found: ({ method, path }) => `Cooper has nothing at ${method} ${path}`,
  internal: () => 'Something went wrong on our side. Try again in a moment.',
}

/**
 * Sets cooper's messages for the whole process: once, as the server starts
 * (`index.ts`), before any request. Every context answers with them.
 */
export function setCooperMessages(): void {
  setMessages(cooperMessages)
}
```

It is `Partial`: any message it does not give keeps newt's. Only the message changes;
the `code` stays `not_signed_in`, and a client that acts on it never notices. The
messages belong to the process, not to a context, so `index.ts` sets them before
opening any (chapter [2](./02-a-context)). cooper's test runs it in a process of its
own, since every other test in the same process reads newt's defaults:

```ts
// cooper/backend/shared/messages.test.ts
expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
  conflict: 'Someone else changed this a moment ago. Reload it and try again.',
  reference: 'That column is not there any more (c1)',
  route: { status: 404, body: { error: 'Cooper has nothing at GET /api/nothing', code: 'route_not_found' } },
})
```

The messages of your own errors you write yourself, in each error class, as above.

## 6. The repository

The repository is **the only thing** that reads and writes boards. When entities are
rows of one table, as here, it is enough to extend `TableRepository` and say how a row
becomes an entity:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Board, type BoardDTO } from './board'
import { BoardNameTaken } from './errors/board-name-taken'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
      // Archiving stamps `deletedAt`: an archived board is in no list, and its name is free again.
      softDelete: true,
      // Every find, count and page sees the current workspace's boards only.
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }

  /**
   * Saves a board only if no other one of its workspace has its name, whatever the
   * case: counted again after writing it, in its transaction, guarding the name in
   * lower case, so no other save of that name slips in between. `Roadmap` and
   * `ROADMAP` created at once cannot both have it. Only A to Z are folded, as `ieq`
   * and the table's unique index compare: `Ärger` and `ärger` are two names.
   */
  async persistWithNameFree(board: Board): Promise<void> {
    const { workspaceId, name } = board
    await this.save([board], each => this.write(each), {
      guard: [`boardName:${workspaceId}:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
      },
    })
  }

  // … recentInEveryScope, for the staff (chapter 22), and purgeWorkspace, for when auth deletes a workspace (chapter 16)
}
```

With that you already have `find`, `first`, `count`, `page` and `persist`. Three
options shape this table:

- **`unique`** says which fields cannot repeat, in words every store understands. A SQL
  store already knows it from the unique index of its migration (below) and ignores
  the option; the file store checks it itself.
- **`softDelete: true`** turns the deletion `archive()` asks for into a `deletedAt`
  stamp. Archived boards drop out of every `find`, `count` and `page`.
- **`scope`** makes every read see only the current workspace's boards, and every write
  check that it stays in it. A use case cannot forget the workspace, because it never
  writes it. Chapter [5](./05-who-and-where) explains scopes.

`persistWithNameFree` is the board's own way to save: it keeps the rule "one name per
workspace, whatever its case" even when two people create `Roadmap` and `ROADMAP` at
the same instant. Chapters [7](./07-concurrency) and [8](./08-rules-over-rows) explain
`guard` and `after`. For now, read it as "save, and if another board of the workspace
has this name, undo it all and say so".

### Criteria

To look things up, a repository takes **criteria**, field by field:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
this.repo.find({ id })                                  // equal to
this.repo.first({ name: { ieq: BoardName.from(name) } }) // equal, whatever its case (A to Z)
this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } })
this.repo.page({}, page, { newestFirst: true })         // a page
```

The operators are `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte` and `ieq`. A field whose
value is `undefined` is no condition at all, so an optional filter needs no `if`: in
the `count` above, `id` only counts when there is an `exceptId`. All the fields of a
criteria must hold at once; for "or", there are `and` and `or` groups (chapter
[23](./23-search)).

### The table

The repository says `'board'`; the table is created by a SQL migration of the context
(chapter [24](./24-migrations)). Field names are camelCase in the code and snake_case
in SQL: the store translates them.

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- An archived board keeps its row (`deleted_at` set): its name is free again.
CREATE TABLE board (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

The partial index (`WHERE deleted_at IS NULL`) is what frees an archived board's name.
There is no foreign key on `workspace_id`: the workspace lives in another context's
database.

## 7. The module and its use cases

The module puts it all together: the repository, the events it offers to others, and
its use cases.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import { eventsOf, Module, UseCase, type Page, type PageRequest } from 'newt/core'
// … the module's own imports

/**
 * The boards of each workspace. Every use case works in the current workspace (the
 * scope its route, worker or script entered): the repository sees no other. Those
 * another context calls name their workspace instead, and enter it.
 */
export class Board_Module extends Module {

  static initialize(base: BoardsBase, deps: Board_Deps): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base))
    registerBoardRoutes(base, module, deps)
    return module
  }

  readonly events

  private constructor(base: BoardsBase, private readonly repo: Board_Repository) {
    super('board', base.invocations)
    this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  }

  /** A page of the workspace's boards, the newest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<BoardDTO>> {
    const found = await this.repo.page({}, page, { newestFirst: true })
    return {
      items: found.items.map(board => board.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  @UseCase()
  async get(id: string): Promise<BoardDTO> {
    return (await this.load(id)).toDTO()
  }

  @UseCase()
  async create(input: BoardCreateDTO): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    await this.assertNameFree(BoardName.from(name))
    const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }

  /** Renames it, describes it, or both. */
  @UseCase()
  async update(id: string, input: BoardUpdateDTO): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(BoardName.from(changes.name), id)
    board.update(changes)
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }

  /** Out of every list for good; its columns and cards stay, pointing at it. */
  @UseCase()
  async archive(id: string): Promise<void> {
    const board = await this.load(id)
    board.archive()
    await this.repo.persist(board)
  }

  // … listOf, recentInEveryWorkspace, findByName and purgeWorkspace, for other modules and contexts

  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }

  /** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
  private async assertNameFree(name: BoardName, exceptId?: string): Promise<void> {
    if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
  }
}
```

- **`super('board', …)`** names the module, and **`@UseCase()`** turns each public
  method into a use case called `board.create`, `board.update`… Those are the names you
  will see in traces, in queue names and in the write rule.
- **`events`** gathers the events the module offers to others.
  `eventsOf(base.bus, { created: Board_Created, … })` builds them with their types, and
  from outside they read as what they are: `board.events.created`. Chapter
  [11](./11-reacting) uses them.
- **`static initialize`** creates the module and registers its routes. It is what the
  context calls. The constructor is private.
- **`currentWorkspaceId()`** is where the board's workspace comes from: the scope the
  route entered, never the request body.
- **`resolve(find, onMissing)`** turns a search into one entity or an error you choose:
  here `BoardNotFound`, a 404. Chapter [4](./04-use-cases) says when to choose which.
- **`assertNameFree`** checks the name before anything is written, to answer clearly in
  the usual case. The save checks it again, where nothing can slip in between.
- If someone else changed the board between reading and saving it, the use case runs
  again on its own: chapter [7](./07-concurrency).

### What it uses: `board.deps.ts`

A module says which other modules it uses in its `deps` file:

```ts
// cooper/backend/contexts/boards/modules/board/board.deps.ts
import type { Member_Module } from '../member/member.module'

export interface Board_Deps {
  /** Who may enter each workspace: its routes run in the workspace scope it gives. */
  member: Member_Module
}
```

The board's use cases need nothing from other modules. Its routes do: they run inside a
workspace, and the `member` module is the one that says who may enter it. Chapter
[17](./17-modules-talk) is about deps.

## 8. The routes

A route reads the request, calls a use case, and answers. **Nothing more.** All the
logic lives in the use case, so it works the same called from HTTP, from an MCP tool,
from a script or from another module.

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { BoardCreateDTO, BoardUpdateDTO } from './board'
import type { Board_Deps } from './board.deps'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module, deps: Board_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  workspace.post('/boards', async request => {
    const input = await request.json() as BoardCreateDTO
    return Response.json(await boards.create(input), { status: 201 })
  })

  workspace.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))

  workspace.patch('/boards/:boardId', async request => {
    const input = await request.json() as BoardUpdateDTO
    return Response.json(await boards.update(request.params.boardId, input))
  })

  workspace.post('/boards/:boardId/archive', async request => {
    await boards.archive(request.params.boardId)
    return new Response(null, { status: 204 })
  })
}
```

- **`workspaceRoutes`** is a group of the router, under `/workspaces/:workspaceId`. Its
  middleware checks that the person signed in belongs to the workspace, and runs the
  route inside it. Every module of `boards` registers its routes on it. Chapter
  [5](./05-who-and-where) builds it.
- Every route hangs from `/api`: `/boards` is
  `/api/workspaces/:workspaceId/boards`.
- The path types its parameters: in `/boards/:boardId`, `request.params.boardId`
  exists and is a `string`.
- **Every route needs an actor**, unless you register it with `{ public: true }`.
  Without one, it answers 401.
- **There is no `try/catch`.** If the use case throws a `BoardNotFound`, the router
  answers 404 with `{ error, code }`. A body that does not pass the use case's schema
  is a 400 (`validation`, with its `issues`); one that cannot be read is a 400
  (`malformed_body`); a JSON body sent without `Content-Type: application/json` is a
  415 (`unsupported_media_type`). Any other error is a 500 that tells nothing about
  the inside.
- `as BoardCreateDTO` is not a check, only a type for the editor. The check is the
  use case's `parse`.

## 9. Registering it

In the context, the module is initialized in `initializeModules`, after the modules it
uses:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  // …
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  // …
  return { session, member, board, column, card, workspace, activity, outbox }
}
```

`member` comes before `board` because `board` uses it; `column` comes after because it
uses `board`. If you get the order wrong, TypeScript tells you: you cannot pass a
variable before it is declared.

## 10. Testing it

cooper's tests open the real context, on SQLite in memory, and call its use cases as a
route would. `boards` has a helper that opens it with a fake `auth` behind its ports
(who belongs to which workspace is kept in memory), and takes who sends a request from
an `x-user` header instead of a session cookie:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mails: Mail[] = []
  const lines: string[] = []
  const boards = await Boards_Context.open({ ...config.boards, dbPath: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
    auth: auth.modules,
    mailer: { send: async mail => { mails.push(mail) } },
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    // …
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` (or an MCP tool) does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    // …
  }
}
```

The module's tests then read like its rules:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
describe('board', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('globex', 'bea')
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const create = (name: string) => inAcme(() => t.modules.board.create({ name }))

  test('keeps a name as a board\'s name: trimmed, one space between words, 1 to 60 characters', async () => {
    expect(String((await create('  Road   map ')).name)).toBe('Road map')
    await expect(create('   ')).rejects.toMatchObject({ code: 'board.invalid_name' })
    await expect(create('x'.repeat(61))).rejects.toMatchObject({ code: 'board.invalid_name' })
  })

  test('gives a name to one board of a workspace, whatever its case; another workspace has its own', async () => {
    await create('Roadmap')

    await expect(create('ROADMAP')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await t.as('bea', 'globex', () => t.modules.board.create({ name: 'roadmap' }))).workspaceId).toBe('globex')
    // …
  })

  test('archives a board: out of every list, and its name free again', async () => {
    const roadmap = await create('Roadmap')

    await inAcme(() => t.modules.board.archive(roadmap.id))

    await expect(inAcme(() => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
    expect((await create('Roadmap')).id).not.toBe(roadmap.id)
  })

  // …
})
```

```bash
bun test cooper/backend/contexts/boards/modules/board
```

### Through HTTP

`boards.context.test.ts` serves the same test context on a free port and calls it with
`fetch`, with `x-user` saying who calls. These are the answers it gets, request by
request:

```http
POST /api/workspaces/acme/boards
x-user: ana
content-type: application/json

{"name":"  Road   map ","description":"What comes next"}

→ 201
{"id":"01a177d6-7444-750a-b84f-bb1e82121256","workspaceId":"acme","name":"Road map",
 "description":"What comes next","createdAt":"2026-10-26T10:51:45.605Z","updatedAt":"2026-10-26T10:51:45.605Z"}
```

```http
POST /api/workspaces/acme/boards
{"name":"ROAD MAP"}

→ 409
{"error":"There is a board called ROAD MAP in this workspace already","code":"board.name_taken"}
```

```http
POST /api/workspaces/acme/boards
{"name":"   "}

→ 400
{"error":"'   ' is not a board's name: it has 1 to 60 characters","code":"board.invalid_name"}
```

```http
POST /api/workspaces/acme/boards
{"description":5}

→ 400
{"error":"The request is not valid","code":"validation","issues":[
  {"expected":"string","code":"invalid_type","path":["name"],"message":"Invalid input: expected string, received undefined"},
  {"expected":"string","code":"invalid_type","path":["description"],"message":"Invalid input: expected string, received number"}]}
```

```http
GET /api/workspaces/acme/boards/nope

→ 404
{"error":"There is no board nope","code":"board.not_found"}
```

```http
GET /api/workspaces/acme/boards
x-user: bea

→ 404
{"error":"There is no workspace acme","code":"workspace.not_found"}
```

The last one is Bea, who is not in Acme. To her, Acme does not exist: chapter
[5](./05-who-and-where) explains why that is a 404 and not a 403.

The test does not call `setCooperMessages`, so the `validation` answer above carries
newt's own message. The running server answers the same request with cooper's:
`"Some of what was sent is not right: check the fields and try again"`, and the same
`code` and `issues`.

On the running app, after `bun run cooper:seed`, the rows are in
`data/cooper-boards.db`:

```bash
sqlite3 -header -column data/cooper-boards.db "select name, description, version, deleted_at from board"
```

```
name     description                                                          version  deleted_at
-------  -------------------------------------------------------------------  -------  ----------
Welcome  A first board to find your way around: move the card, add your own.        1
Launch   Everything left before Acme's launch.                                      1
```

Each board has one more column than its DTO: `version`, which is 1 after its first save.

## In short

- A module is always the same files: schema, entity, events, errors, repository, deps,
  module, routes, tests; and `value-objects/` when it has values with rules.
- The schema is the contract. Input schemas have only what a client may send, and reuse
  the rules of the whole one.
- A value object keeps a value's rules in one place: `from` for what someone typed,
  `schema` for how it is kept. Its brand stops an unchecked value at compile time.
- Only the entity changes itself, with business methods that note their events. It is
  born through `create` or read through `fromDTO`. Outside its module, only its DTO
  exists.
- Each error is a class with a stable `code`; its base decides the HTTP status.
  newt's own messages are changed once, at startup, with `setMessages`; their codes
  never change.
- Only the repository touches the store.
- Use cases validate their input, return DTOs, and are named `<module>.<method>`.
- A route reads, calls one use case and answers: no logic, no `try/catch`.
