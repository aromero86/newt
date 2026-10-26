# Cards and a shared counter

A board has columns; now it gets what goes in them. A card is something to do: a
title, a description, the column of its status, and maybe someone it is assigned to.
Every card of a board has a number, #1, #2, #3…, and people use it: "#12 is
blocked". So two cards created at the same moment on the same board must get two
different numbers, and a number must never come back: if #12 is deleted, "#12" in
last week's message must not end up meaning another card.

A board's next number is a value **everyone changes at once**: every new card of the
board takes it and moves it one up. This chapter adds the card module, and shows
where cooper keeps that number and how two cards created at once take turns on it
instead of colliding.

Two designs that look right do not work:

- **A counter on the board**, read and increased by every new card. The board is
  another module: creating a card would write two modules in one use case. And the
  board row would collide with anything else that saves it, a rename say.
- **No counter: the highest number left, plus one.** It only sees the cards still
  there. Cards are deleted for good (chapter [8](./08-two-people-one-card)): delete #3
  of three, and the next card gets #3 again.

cooper keeps the last number each board gave in a table of the **card module**:
`card_counter`, one row per board, written in the same save as the card.

## The tables

The migration adds two tables: the cards, and their counters.

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00003_card_up.sql
-- A card points at its board, its column and the member it is assigned to by id: the
-- column is another module's, the member another context's.
CREATE TABLE card (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee_id TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
CREATE INDEX card_column ON card (workspace_id, column_id, position);
CREATE INDEX card_assignee ON card (workspace_id, assignee_id);

-- The last number each board gave a card, so a deleted card's number is never given
-- again: cards are deleted for good, and the highest one left is not the last one
-- given. Its id is the board's.
CREATE TABLE card_counter (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);
```

A card points at its board, its column and its assignee by id, never by a foreign key:
the column is another module's, the assignee another context's. The unique index on
`(board_id, number)` is the last word on numbers: whatever the code does, the table
never holds two #7 on one board.

`card_counter` has no entity of its own. Its `id` is the board's, so finding a board's
counter is finding by id. It has a `version` like every row a store writes.

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00003_card_down.sql
DROP TABLE card_counter;
DROP TABLE card;
```

## The schema

`card.schema.ts` says what a card is, and the shapes a client sends to create, edit
and assign one. It also holds `MAX_CARDS`: a board is read whole, as one screen, so
it has a limit, like a board's ten columns.

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
import { z } from 'zod'

/** The most cards a board holds: a board is read whole, as one screen. */
export const MAX_CARDS = 500

/** A card of a board: something to do, in the column of its status. */
export const CardSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  /** Its status: the column it is in, by id. The column is another module's. */
  columnId: z.string(),
  /** #1, #2…: its board's, in the order its cards were created, never reused. */
  number: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000),
  /** Who it is assigned to: a member of the workspace, by their user's id in auth. */
  assigneeId: z.string().nullable(),
  /** Where it is in its column, from 0 at the top: a column's cards are 0, 1, 2… without gaps. */
  position: z.number().int().min(0),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

const description = z.string().trim().pipe(CardSchema.shape.description)

export const CardCreateSchema = CardSchema.pick({ columnId: true, title: true }).extend({
  description: description.default(''),
  assigneeId: CardSchema.shape.assigneeId.default(null),
})
export const CardEditSchema = z.object({ title: CardSchema.shape.title, description }).partial()
export const CardAssignSchema = z.object({ assigneeId: z.string() })

export type CardDTO = z.infer<typeof CardSchema>
export type CardCreateDTO = z.input<typeof CardCreateSchema>
export type CardEditDTO = z.input<typeof CardEditSchema>
export type CardAssignDTO = z.input<typeof CardAssignSchema>
```

`CardCreateSchema` takes only what a client decides: the column, the title, and
optionally a description and an assignee. The number and the position are cooper's.

## The entity

`Card` is built as `Column` was. A new one is created with the number and the place
it looked to get; `place` gives it the ones it really gets, inside the save, and only
while it is new.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
import { Entity, type EntityInput } from 'newt/core'
import { CardSchema, type CardDTO } from './card.schema'

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

  static create(input: CardOpening): Card {
    return new Card(input, true)
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
   * between.
   */
  place(number: number, position: number): void {
    if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
    this.change({ number, position })
  }

  edit(changes: { title?: string, description?: string }): void {
    this.change(changes)
  }

  /** To a member of its workspace: the module checked they are. */
  assign(assigneeId: string): void {
    this.change({ assigneeId })
  }

  unassign(): void {
    this.change({ assigneeId: null })
  }
}
```

The entity checks nothing about who the assignee is: it cannot know. The module
checks it and then calls `assign`.

## Its errors

Four errors, one file each, as before. A missing card is a 404:

```ts
// cooper/backend/contexts/boards/modules/card/errors/card-not-found.ts
import { NotFoundError } from 'newt/core'

export class CardNotFound extends NotFoundError {
  readonly code = 'card.not_found'
  constructor(id: string) {
    super(`There is no card ${id}`)
  }
}
```

A board with `MAX_CARDS` already is a conflict with the state of things (409):

```ts
// cooper/backend/contexts/boards/modules/card/errors/too-many-cards.ts
import { ConflictError } from 'newt/core'
import { MAX_CARDS } from '../card.schema'

export class TooManyCards extends ConflictError {
  readonly code = 'card.too_many'
  constructor(boardId: string) {
    super(`Board ${boardId} has ${MAX_CARDS} cards already: that is the most a board holds`)
  }
}
```

A column of another board, or an assignee from outside the workspace, is a mistake of
the request (400):

```ts
// cooper/backend/contexts/boards/modules/card/errors/column-not-in-board.ts
import { ValidationError } from 'newt/core'

/** A card goes only to a column of its own board: the request named another. */
export class ColumnNotInBoard extends ValidationError {
  readonly code = 'card.column_not_in_board'
  constructor(columnId: string, boardId: string) {
    super(`Column ${columnId} is not a column of board ${boardId}`)
  }
}
```

```ts
// cooper/backend/contexts/boards/modules/card/errors/assignee-not-member.ts
import { ValidationError } from 'newt/core'

/** A card is assigned only to someone of its workspace: the request named anyone else. */
export class AssigneeNotMember extends ValidationError {
  readonly code = 'card.assignee_not_member'
  constructor(userId: string) {
    super(`${userId} is not a member of this workspace: a card is assigned to one of its members`)
  }
}
```

## What the card module needs

A card needs three modules: the board, to check it exists in the workspace; the
column, to check the column is the board's; and the member module, to check an
assignee belongs to the workspace. All three are reads, calls to their use cases.

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
import type { Board_Module } from '../board/board.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace. */
  member: Member_Module
}
```

The member module can tell whether *the signed-in person* belongs to a workspace
(`enter`), but not whether *someone else* does. Add `isMember` to it, and import
`currentWorkspaceId`:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
import { currentWorkspaceId, type WorkspaceScope } from '../../workspace-scope'
// …
  /** Whether someone belongs to the current workspace. */
  @UseCase()
  async isMember(userId: string): Promise<boolean> {
    return this.deps.workspaces.isMember(currentWorkspaceId(), userId)
  }
```

It goes after `enter`. It asks auth (here, the fake one) every time: a member removed
a minute ago is no member now.

## The repository: a second table

The repository is where the counter lives. Its entities are the rows of `card`, so it
is a `TableRepository`, as before. The counters are a second table it opens beside
its own with `base.store.table<CardCounterRow>('card_counter')`: a `Table` is the
store's plain access to rows (`find`, `insert`, `update`, `delete`), with no entity.
No other module ever sees it.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Card, MAX_CARDS, type CardDTO } from './card'
import { TooManyCards } from './errors/too-many-cards'

export type CardRow = CardDTO & { version: number }

/** The last number a board gave a card: its id is the board's. A card deleted does not give it back. */
export type CardCounterRow = { id: string, workspaceId: string, lastNumber: number, version: number }

export class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {

  private readonly counters

  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card', { unique: [['boardId', 'number']] }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
    this.counters = base.store.table<CardCounterRow>('card_counter')
  }

  protected toEntity(row: CardRow): Card {
    return Card.fromDTO(row)
  }

  /** The number the next card of a board gets: one more than the last one it gave. */
  async nextNumber(boardId: string): Promise<number> {
    const [counter] = await this.counters.find({ id: boardId })
    return (counter?.lastNumber ?? 0) + 1
  }

  /**
   * Saves a new card with the next number of its board and at the bottom of its
   * column, both read inside the save, and only if the board is left with no more
   * than `MAX_CARDS`. The save guards the board's cards and the column's order: two
   * cards created at once in a board get #7 and #8, in any store, and neither waits
   * for a conflict to try again.
   *
   * The number is a value everyone changes at once: each board keeps the last one it
   * gave in a row of its own, which every new card of the board updates. Updated in
   * place, those saves would collide with each other; under the board's guard, they
   * take turns instead, and none is refused. The row is never lowered, so a deleted
   * card's number, even the last one's, is not given again. The table's unique index
   * on (board, number) is the last word.
   */
  async persistNew(card: Card): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`boardCards:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
      after: async () => {
        const count = await this.count({ boardId })
        if (count > MAX_CARDS) throw new TooManyCards(boardId)
      },
    })
  }

  /** The board's next number, taken: its counter one up, in the save of the card that gets it. */
  private async takeNumber(card: Card): Promise<number> {
    const [counter] = await this.counters.find({ id: card.boardId })
    if (!counter) {
      await this.counters.insert({ id: card.boardId, workspaceId: card.workspaceId, lastNumber: 1 })
      return 1
    }
    const number = counter.lastNumber + 1
    await this.counters.update(counter.id, counter.version, { lastNumber: number })
    return number
  }
}
```

Read `persistNew` slowly; it is the chapter.

**The number is taken inside the save.** `takeNumber` reads the counter and moves it
one up, in `before`, in the same transaction as the card. A board's first card
creates the row. Every later one updates it with `update(id, version, changes)`: the
row must still be at the version read, or the store throws `ConcurrencyConflict`.
Nothing here ever lowers it, so a number given is never given again.

**The guard turns the collision into a queue.** Two cards created at once would both
read `lastNumber: 6` and both try to write 7. Under the key `boardCards:<board id>`,
two saves never interleave, in any store: the second starts once the first has
committed, reads 7, and writes 8. Neither is refused and neither runs again. This is
the `guard` you met in chapter [6](./06-rules-over-rows), used for a value instead of
a rule.

**One save may guard several keys.** `cards:<column id>` guards the column's order:
the position is the count of the column's cards, read in the same `before`, so two
cards created at once in a column get 0 and 1, never 0 and 0. Chapter
[8](./08-two-people-one-card) uses that key to move cards.

**`after` checks the rule over the board's cards.** `MAX_CARDS` is a rule over
several rows, like `MAX_COLUMNS`: it is counted after writing, under the board's
guard, and throwing rolls back the card and its number together.

`nextNumber` reads without taking anything. The module uses it to build a valid card
before saving: what it reads is a guess, which `before` replaces with what is true.

::: tip
A value many change at once (a counter, a stock, a balance) is not a field read in a
use case and saved: every change would collide with the others. Keep it in the module
that changes it, and take it inside the save, in `before`, under a guard on what it
counts.
:::

## The module

`Card_Module` has the use cases: list a board's cards, get one by id or by number,
create, edit, assign and unassign.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  MAX_CARDS,
  type CardAssignDTO,
  type CardCreateDTO,
  type CardDTO,
  type CardEditDTO,
} from './card'
import type { Card_Deps } from './card.deps'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { AssigneeNotMember } from './errors/assignee-not-member'
import { CardNotFound } from './errors/card-not-found'
import { ColumnNotInBoard } from './errors/column-not-in-board'
import { TooManyCards } from './errors/too-many-cards'

/**
 * The cards of each board: what there is to do, in the column of its status, and
 * who does it. A card points at its board and its column (modules of `boards`) and at
 * its assignee (a member, kept by auth), each by id.
 */
export class Card_Module extends Module {

  static initialize(base: BoardsBase, deps: Card_Deps): Card_Module {
    const module = new Card_Module(base, new Card_Repository(base), deps)
    registerCardRoutes(base, module, deps)
    return module
  }

  private constructor(
    base: BoardsBase,
    private readonly repo: Card_Repository,
    private readonly deps: Card_Deps,
  ) {
    super('card', base.invocations)
  }

  /**
   * A board's cards, column by column and from the top: whole, since a board is read
   * as one screen and holds at most `MAX_CARDS`.
   */
  @UseCase()
  async listInBoard(boardId: string): Promise<CardDTO[]> {
    const cards = await this.repo.find({ boardId }, { orderBy: [{ field: 'columnId' }, { field: 'position' }] })
    return cards.map(card => card.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<CardDTO> {
    return (await this.load(id)).toDTO()
  }

  /** A card by its number on its board: #12 of the roadmap. */
  @UseCase()
  async getByNumber(boardId: string, number: number): Promise<CardDTO> {
    return (await this.resolve(() => this.repo.find({ boardId, number }), () => new CardNotFound(`#${number}`))).toDTO()
  }

  /**
   * A new card at the bottom of a column of the board, with the board's next number:
   * a board holds at most `MAX_CARDS`.
   */
  @UseCase()
  async create(boardId: string, input: CardCreateDTO): Promise<CardDTO> {
    const card = await this.newCard(boardId, input)
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (await this.repo.count({ boardId }) >= MAX_CARDS) throw new TooManyCards(boardId)
    await this.repo.persistNew(card)
    return card.toDTO()
  }

  @UseCase()
  async edit(id: string, input: CardEditDTO): Promise<CardDTO> {
    const changes = CardEditSchema.parse(input)
    const card = await this.load(id)
    card.edit(changes)
    await this.repo.persist(card)
    return card.toDTO()
  }

  /** Assigns it to a member of its workspace: anyone else is a mistake of the request (400). */
  @UseCase()
  async assign(id: string, input: CardAssignDTO): Promise<CardDTO> {
    const { assigneeId } = CardAssignSchema.parse(input)
    const card = await this.load(id)
    await this.assertMember(assigneeId)
    card.assign(assigneeId)
    await this.repo.persist(card)
    return card.toDTO()
  }

  @UseCase()
  async unassign(id: string): Promise<CardDTO> {
    const card = await this.load(id)
    card.unassign()
    await this.repo.persist(card)
    return card.toDTO()
  }

  /** A new card of a board, checked: its column is the board's, its assignee a member. */
  private async newCard(boardId: string, input: CardCreateDTO): Promise<Card> {
    const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
    const board = await this.deps.board.get(boardId)
    await this.assertColumnOf(boardId, columnId)
    if (assigneeId !== null) await this.assertMember(assigneeId)
    return Card.create({
      workspaceId: board.workspaceId,
      boardId,
      columnId,
      // What they look to be now; the save reads them again, where nothing slips in.
      number: await this.repo.nextNumber(boardId),
      position: await this.repo.count({ columnId }),
      title,
      description,
      assigneeId,
    })
  }

  private load(id: string): Promise<Card> {
    return this.resolve(() => this.repo.find({ id }), () => new CardNotFound(id))
  }

  /** The column a card goes to is one of its board's: asked to the column module, a read. */
  private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
    const columns = await this.deps.column.list(boardId)
    if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
  }

  /** The assignee belongs to the workspace now: asked to auth, through the member module, every time. */
  private async assertMember(userId: string): Promise<void> {
    if (!await this.deps.member.isMember(userId)) throw new AssigneeNotMember(userId)
  }
}
```

`create` follows the shape of every use case: validate, load what it needs, decide,
save. `newCard` checks the references by asking their modules: `board.get` (404 when
the board is not the workspace's), `column.list` (the column must be one of the
board's) and `member.isMember`. Each is a read of another module through its use
cases; the card module never touches their tables.

The count before `persistNew` gives a clear `card.too_many` in the usual case. The
save counts again, where nothing slips in between: a board of 497 cards and six
created at once ends with 500, and three of the six get `card.too_many`.

`listInBoard` returns the whole list, with no page: a rule of the domain bounds it
(`MAX_CARDS`), as `MAX_COLUMNS` bounds a board's columns.

## The routes

The routes go on the workspace group, as the columns' do: each runs in the workspace
once `member.enter` let the person in.

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { CardAssignDTO, CardCreateDTO, CardEditDTO } from './card'
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

export function registerCardRoutes(base: BoardsBase, cards: Card_Module, deps: Card_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/cards', async request => Response.json(await cards.listInBoard(request.params.boardId)))

  workspace.post('/boards/:boardId/cards', async request => {
    const input = await request.json() as CardCreateDTO
    return Response.json(await cards.create(request.params.boardId, input), { status: 201 })
  })

  workspace.get('/cards/:cardId', async request => Response.json(await cards.get(request.params.cardId)))

  workspace.patch('/cards/:cardId', async request => {
    const input = await request.json() as CardEditDTO
    return Response.json(await cards.edit(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/assign', async request => {
    const input = await request.json() as CardAssignDTO
    return Response.json(await cards.assign(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/unassign', async request => Response.json(await cards.unassign(request.params.cardId)))
}
```

## Wiring it

`initializeModules` initializes the card module after the three it uses:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
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
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member })
  return { member, board, column, card }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

## Tests

The card's tests open `boards` in memory, with ana and bea in acme and carl in
globex, a board and three columns.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { MAX_CARDS, type CardCreateDTO } from './card.schema'

describe('card', () => {
  let t: TestBoards
  let boardId: string
  let todo: string
  let doing: string
  let done: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('acme', 'bea')
    t.auth.join('globex', 'carl')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
    ;[todo, doing, done] = await Promise.all(['To do', 'Doing', 'Done'].map(name => inAcme(() => t.modules.column.add(boardId, { name })))).then(columns => columns.map(column => column.id))
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const create = (title: string, input: Partial<CardCreateDTO> = {}) => inAcme(() => t.modules.card.create(boardId, { columnId: todo, title, ...input }))
  /** Each column's cards from the top, as `#number@position`. */
  const columns = async () => {
    const cards = await inAcme(() => t.modules.card.listInBoard(boardId))
    const of = (columnId: string) => cards.filter(card => card.columnId === columnId).map(card => `#${card.number}@${card.position}`)
    return { todo: of(todo), doing: of(doing), done: of(done) }
  }

  test('numbers a board\'s cards #1, #2… and puts each new one at the bottom of its column', async () => {
    await create('Plan')
    await create('Design', { columnId: doing })
    await create('Build')

    expect(await columns()).toEqual({ todo: ['#1@0', '#3@1'], doing: ['#2@0'], done: [] })
    expect((await inAcme(() => t.modules.card.getByNumber(boardId, 2))).title).toBe('Design')
  })

  test('gives distinct numbers and places to cards created at once', async () => {
    const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

    const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
    expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  test('holds up to MAX_CARDS cards in a board, however many are created at once', async () => {
    await Promise.all(Array.from({ length: MAX_CARDS - 3 }, (_, i) => create(`Task ${i}`)))

    const created = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => create(`More ${i}`)))

    expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(3)
    for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'card.too_many' })
    expect(await inAcme(() => t.modules.card.listInBoard(boardId))).toHaveLength(MAX_CARDS)
  })

  test('creates a card only in a column of its board', async () => {
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const elsewhere = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))

    await expect(create('Lost', { columnId: elsewhere.id })).rejects.toMatchObject({ code: 'card.column_not_in_board' })
  })

  test('edits a card\'s title and description', async () => {
    const plan = await create('Plan')

    const edited = await inAcme(() => t.modules.card.edit(plan.id, { title: ' Plan the launch ', description: 'Dates, people' }))

    expect(edited).toMatchObject({ title: 'Plan the launch', description: 'Dates, people', number: 1 })
  })

  test('assigns a card only to a member of its workspace', async () => {
    const plan = await create('Plan')

    await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })
    await expect(create('Design', { assigneeId: 'carl' })).rejects.toMatchObject({ code: 'card.assignee_not_member' })

    expect((await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))).assigneeId).toBe('bea')
    expect((await inAcme(() => t.modules.card.unassign(plan.id))).assigneeId).toBeNull()
  })
})
```

The second test is the counter's: twenty cards created at once get #1 to #20 and
positions 0 to 19, none repeated, none skipped. The third is the limit's: six created
at once on a board three short of the limit, and only three get in.

In `boards.context.test.ts`, the test that kept a board and its columns now keeps its
cards too, and the board's rename, archive and name check move to a test of their
own. Replace the two tests after the one that lets only members in:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board, its columns and its cards', async () => {
    const board = await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board.status).toBe(201)
    const id = board.body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'Done' })
    const card = await call<{ id: string, number: number }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })
    expect(card).toMatchObject({ status: 201, body: { number: 1 } })

    expect((await call('POST', `/acme/cards/${card.body.id}/assign`, { assigneeId: 'bea' })).body).toMatchObject({ code: 'card.assignee_not_member' })
    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })

    expect((await call<{ name: string }[]>('GET', `/acme/boards/${id}/columns`)).body.map(column => column.name)).toEqual(['To do', 'Done'])
    expect((await call<{ title: string }[]>('GET', `/acme/boards/${id}/cards`)).body.map(each => each.title)).toEqual(['Plan'])

    // Another workspace sees none of it.
    expect((await call('GET', `/globex/boards/${id}`, undefined, 'bea')).status).toBe(404)
  })

  test('renames a board, archives it, and gives its name once', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id

    expect(await call('POST', '/acme/boards', { name: 'ROADMAP' })).toMatchObject({ status: 409, body: { code: 'board.name_taken' } })
    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/acme/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })
```

bea is in globex, not acme, so assigning her a card of acme is `card.assignee_not_member`.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

Then by hand. Start the backend; it runs the new migration on your development
database as it opens:

```sh
bun cooper/backend/index.ts
```

In another terminal, make a board and a column, and create twenty cards at once
(this uses `jq` to read the ids):

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Counter $RANDOM\"}" | jq -r .id)
COLUMN=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
for i in $(seq 1 20); do
  curl -s -o /dev/null -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -d "{\"columnId\":\"$COLUMN\",\"title\":\"Task $i\"}" &
done; wait
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq -c '[.[].number] | sort'
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq -c '[.[].position] | sort'
```

```text
[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]
[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]
```

Every number once, every position once.

## What to remember

- A value everyone changes at once collides with itself if each change is read in a
  use case and saved. Take it inside the save, in `before`, under a `guard` on what
  it counts: saves take turns instead of colliding.
- Keep it in the module that changes it, in a table its repository opens beside its
  own (`base.store.table`), never in a row other saves write too.
- A value that must never come back is kept in a row that only grows, not derived
  from rows that can be deleted.
- A unique index is the last word; the check before the save is the clear answer; the
  check in `after` is the rule.
- A module checks its references by calling the other modules' use cases, never their
  tables.

Next: [Two people, one card](./08-two-people-one-card).
