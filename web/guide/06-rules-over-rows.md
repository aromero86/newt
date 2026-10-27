# Rules over rows

A board gets columns: To do, Doing, Done. Two new rules come with them, and one of
them is about boards themselves:

- **A board has at most ten columns.**
- **A board's name is its workspace's once**, whatever its case: `Roadmap` and
  `ROADMAP` are the same name.

Neither rule can be checked by looking at the row being saved. A version protects one
row: nobody overwrites a board someone else changed. These rules speak about
**several** rows, and a check before saving misses what happens in between:

```text
Ana   counts the columns: 9
Bob   counts the columns: 9
Ana   saves her column     → 10
Bob   saves his column     → 11
```

Both counted, both found room, and the board has eleven. No version helps: the two
columns are new rows, and neither touches the other.

This chapter shows how newt checks a rule over several rows inside the save, and how
the save says what it protects so the rule holds on every store. You also write your
second module, `column`, which uses `board`.

## The column module

`bunx newt add module cooper/backend/contexts/boards column` would write a skeleton of
this module, with every file named as the lint asks ([appendix G](./g-command-line)).
Here you type the real files, which say more than a skeleton does.

### Its schema and entity

A column belongs to a board, by id, and has a `position`: 0 on the left, then 1, 2…
without gaps. `MAX_COLUMNS` is the rule's number, in one place.

```ts
// cooper/backend/contexts/boards/modules/column/column.schema.ts
import { z } from 'zod'

/** The most columns a board has. */
export const MAX_COLUMNS = 10

/** A board's column: a status its cards are in (To do, Doing, Done…). */
export const ColumnSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  /** The board it is in, by id: the board is another module's. */
  boardId: z.string(),
  name: z.string().trim().min(1).max(40),
  /** Where it is on its board, from 0 on the left: a board's columns are 0, 1, 2… without gaps. */
  position: z.number().int().min(0),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const ColumnAddSchema = ColumnSchema.pick({ name: true })
export const ColumnRenameSchema = ColumnSchema.pick({ name: true })
/** Where it goes: a position past the last one is the last. */
export const ColumnMoveSchema = ColumnSchema.pick({ position: true })

export type ColumnDTO = z.infer<typeof ColumnSchema>
export type ColumnAddDTO = z.input<typeof ColumnAddSchema>
export type ColumnRenameDTO = z.input<typeof ColumnRenameSchema>
export type ColumnMoveDTO = z.input<typeof ColumnMoveSchema>
```

`ColumnMoveSchema` is for moving a column, which needs what chapter 8 teaches. It
waits here until then.

The entity follows the shape of `Board`. The one new method is `place`: a new column
takes its position as it is saved, not before. Why will be clear in a moment.

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
import { Entity, type EntityInput } from 'newt/core'
import { ColumnSchema, type ColumnDTO } from './column.schema'

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
    return new Column(input, true)
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
  }

  rename(name: string): void {
    this.change({ name })
  }
}
```

### Its errors

A column that is not there is a 404:

```ts
// cooper/backend/contexts/boards/modules/column/errors/column-not-found.ts
import { NotFoundError } from 'newt/core'

export class ColumnNotFound extends NotFoundError {
  readonly code = 'column.not_found'
  constructor(id: string) {
    super(`There is no column ${id}`)
  }
}
```

A full board is a `ConflictError`, a 409: the request is fine, the state of the board
refuses it.

```ts
// cooper/backend/contexts/boards/modules/column/errors/too-many-columns.ts
import { ConflictError } from 'newt/core'
import { MAX_COLUMNS } from '../column.schema'

export class TooManyColumns extends ConflictError {
  readonly code = 'column.too_many'
  constructor(boardId: string) {
    super(`Board ${boardId} has ${MAX_COLUMNS} columns already: that is the most a board has`)
  }
}
```

Do not confuse it with `ConcurrencyConflict`, also a 409, which you meet in chapter 8:
that one makes the use case run again. Running again would not make room on a full
board, so `TooManyColumns` is a plain `ConflictError`.

### Its table

`column` is a word of SQL, so the table's name is quoted. Like `board`, every row says
its workspace. The index serves the one query the module makes: a board's columns, in
order.

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00002_column_up.sql
-- Each board's columns, from the left.
-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX column_board ON "column" (workspace_id, board_id, position);
```

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00002_column_down.sql
DROP TABLE "column";
```

A new migration, `00002`. You do not touch `00001`: chapter 5 showed why.

## Checking inside the save

So far every repository saved with `persist`. Behind it is `save`, a protected method
of newt's `Repository`, which `TableRepository` extends. `persist` is just this:

```ts
await this.save(entities, entity => this.write(entity))
```

Read its three arguments one by one:

```ts
save(entities, write, { guard, before, after })
```

- **`entities`**: what the save writes, all or none, in one transaction. Each one
  stored must still be the version it was read as. `persist` only saves entities of
  its own module.
- **`write`**: how to write one entity, inside the transaction. `TableRepository`
  already has one, `this.write(entity)`, which inserts or updates its row. It is
  called only for entities with changes.
- **The hooks**, all optional, run in the same transaction:
  - **`guard`**: what the save protects, as keys you choose (`columns:<board id>`).
    **Two saves that share a key never run side by side**, on any store: the second
    waits until the first commits or rolls back. Saves with no key in common do not
    wait for each other (on Postgres and MySQL; on SQLite and files every save takes
    its turn anyway).
  - **`before`**: what must happen before the entities are written. It may read, and
    write what must go first.
  - **`after`**: runs once the entities are written. It checks the rule over several
    rows; **throwing rolls everything back**.

In order, a save does this:

```text
open the transaction
take the guard's keys            (wait for any other save holding one of them)
before()
write(entity) for each entity that changed
after()
commit                           (or, if anything threw, roll it all back)
```

When a save rolls back, its entities are put back as they were before it, and newt
refuses to save them again (`SaveRolledBack`): what they would say might no longer be
true. A use case that wants to try again reads them again.

### A column at the end of a board, ten at most

Here is the column repository. `persistAdded` is the save of a new column:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Column, MAX_COLUMNS, type ColumnDTO } from './column'
import { TooManyColumns } from './errors/too-many-columns'

export type ColumnRow = ColumnDTO & { version: number }

export class Column_Repository extends TableRepository<Column, ColumnRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<ColumnRow>('column'), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: ColumnRow): Column {
    return Column.fromDTO(row)
  }

  /** A board's columns, from left to right. */
  ofBoard(boardId: string): Promise<Column[]> {
    return this.find({ boardId }, { orderBy: [{ field: 'position' }] })
  }

  /**
   * Saves a new column at the end of its board, only if the board is left with no more
   * than `MAX_COLUMNS`: a rule over several rows, which no version covers. The
   * save guards its board's columns: its place is read before writing it, and the
   * columns counted after, with no other column of the board added, moved or removed
   * in between, in any store. Ten added at once to a board of five: five get in.
   */
  async persistAdded(column: Column): Promise<void> {
    const { boardId } = column
    await this.save([column], each => this.write(each), {
      guard: [`columns:${boardId}`],
      before: async () => column.place(await this.count({ boardId })),
      after: async () => {
        if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
      },
    })
  }
}
```

Each part has one job:

- **``guard: [`columns:${boardId}`]``**: the rule is about one board's columns, so the
  key is per board. Two people adding columns to the same board take turns; two
  boards never wait for each other. A key as wide as "all columns" would also be
  correct, and would make every board wait for every other.
- **`before`** counts the board's columns and places the new one there: at the end.
  Under the guard, nobody adds a column between that count and this write, so two
  columns never get the same position.
- **`after`** counts again, now with the new column written. More than ten, and it
  throws `TooManyColumns`: the column is not saved.

Now the story ends well:

```text
Ana   takes columns:<board>; places at 9; writes; counts 10 ≤ 10; commits
Bob   (waits for columns:<board>)
Bob   takes it; places at 10; writes; counts 11 > 10; rolls back → column.too_many
```

Ana and Bob added to the same board, so the guard made them take turns. The count in
`after` is the truth, and it stays true until the save commits.

### The use case still checks first

The module counts before saving too:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import {
  Column,
  ColumnAddSchema,
  ColumnRenameSchema,
  MAX_COLUMNS,
  type ColumnDTO,
} from './column'
import type { Column_Deps } from './column.deps'
import { Column_Repository } from './column.repository'
import { registerColumnRoutes } from './column.routes'
import { ColumnNotFound } from './errors/column-not-found'
import { TooManyColumns } from './errors/too-many-columns'

/**
 * The columns of each board: the statuses its cards go through, in order. It knows
 * its boards; it does not know the cards, which point at their column.
 */
export class Column_Module extends Module {

  static initialize(base: BoardsBase, deps: Column_Deps): Column_Module {
    const module = new Column_Module(base, new Column_Repository(base), deps)
    registerColumnRoutes(base, module, deps)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Column_Repository, private readonly deps: Column_Deps) {
    super('column', base.invocations, deps)
  }

  /**
   * A board's columns, from left to right: whole, since a board has at most
   * `MAX_COLUMNS`. A board the workspace does not have has none.
   */
  @UseCase()
  async list(boardId: string): Promise<ColumnDTO[]> {
    return (await this.repo.ofBoard(boardId)).map(column => column.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<ColumnDTO> {
    return (await this.load(id)).toDTO()
  }

  /** A new column, at the end of the board: a board has at most `MAX_COLUMNS`. */
  @UseCase()
  async add(boardId: string, input: unknown): Promise<ColumnDTO> {
    const { name } = ColumnAddSchema.parse(input)
    await this.deps.board.get(boardId)
    const count = await this.repo.count({ boardId })
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
    const column = Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: count })
    await this.repo.persistAdded(column)
    return column.toDTO()
  }

  @UseCase()
  async rename(id: string, input: unknown): Promise<ColumnDTO> {
    const { name } = ColumnRenameSchema.parse(input)
    const column = await this.load(id)
    column.rename(name)
    await this.repo.persist(column)
    return column.toDTO()
  }

  private load(id: string): Promise<Column> {
    return this.resolve(() => this.repo.find({ id }), () => new ColumnNotFound(id))
  }
}
```

The check in `add` gives the clear answer in the usual case, before opening a
transaction. It is not the guarantee: `after` is. Keep both. The same goes for the
position: `add` creates the column where the end looked to be, and `before` places it
where the end is.

`add` also asks `board.get(boardId)` first. That use case runs in the current
workspace, so a board of another workspace, or none, is a `board.not_found`.

`list` returns the columns whole, not a page: a board never has more than ten.
`rename` touches one row and decides nothing about the others, so the version is all
it needs: plain `persist`.

### Using another module

`column` uses `board`, and says so in its `.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/column/column.deps.ts
import type { Board_Module } from '../board/board.module'
import type { Member_Module } from '../member/member.module'

export interface Column_Deps {
  /** That the board a column is added to exists, in the current workspace. */
  board: Board_Module
  member: Member_Module
}
```

A module reaches another only through its use cases (its `.module.ts`), its schema,
its events, its errors and its value objects. Never its entity, its repository, its
tables or its routes. The `newt/module-boundaries` rule of the lint checks it. If
`column` imported `board`'s repository, `bun run lint` would say:

```text
'../board/board.repository' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects  newt/module-boundaries
```

That is why a column keeps a `boardId` and nothing more of its board, and why
`add` asks `board.get` instead of reading the `board` table.

### Its routes

The column routes live on the workspace group too: a board's columns under the board,
and a column by its own id. Each one passes the body to its use case as it came, as
the boards' do: `add` and `rename` take their input as `unknown` and parse it.

```ts
// cooper/backend/contexts/boards/modules/column/column.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Column_Deps } from './column.deps'
import type { Column_Module } from './column.module'

export function registerColumnRoutes(base: BoardsBase, columns: Column_Module, deps: Column_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/columns', async request => Response.json(await columns.list(request.params.boardId)))

  workspace.post('/boards/:boardId/columns', async request => Response.json(await columns.add(request.params.boardId, await request.json()), { status: 201 }))

  workspace.patch('/columns/:columnId', async request => Response.json(await columns.rename(request.params.columnId, await request.json())))
}
```

`column` comes after `board` in `initializeModules`, since it uses it:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'
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
  return { member, board, column }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

### Its tests

The second test is the race from the start of the chapter, eight times over: eight
columns added at once to a board of five. Five get in, three are refused, and the
positions run 0 to 9 without a gap.

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { MAX_COLUMNS } from './column.schema'

describe('column', () => {
  let t: TestBoards
  let boardId: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const add = (name: string) => inAcme(() => t.modules.column.add(boardId, { name }))
  const names = async () => (await inAcme(() => t.modules.column.list(boardId))).map(column => `${column.position}:${column.name}`)

  test('adds columns at the end of the board, up to ten', async () => {
    for (let i = 1; i <= MAX_COLUMNS; i++) await add(`Step ${i}`)

    await expect(add('One more')).rejects.toMatchObject({ code: 'column.too_many' })
    expect(await names()).toEqual(Array.from({ length: MAX_COLUMNS }, (_, i) => `${i}:Step ${i + 1}`))
  })

  test('lets in only the columns that fit, when many are added at once', async () => {
    for (let i = 1; i <= 5; i++) await add(`Step ${i}`)

    const added = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => add(`More ${i}`)))

    expect(added.filter(each => each.status === 'fulfilled')).toHaveLength(5)
    for (const each of added.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'column.too_many' })
    expect((await names()).map(name => Number(name.split(':')[0]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('renames a column', async () => {
    const todo = await add('To do')
    expect((await inAcme(() => t.modules.column.rename(todo.id, { name: ' Backlog ' }))).name).toBe('Backlog')
  })

  test('adds columns only to a board of the workspace', async () => {
    await expect(inAcme(() => t.modules.column.add('nope', { name: 'To do' }))).rejects.toMatchObject({ code: 'board.not_found' })
  })
})
```

## Why say it, if SQLite takes turns anyway

On SQLite, transactions already run one at a time. The race above cannot happen there,
with or without a guard. So why write it?

Because the modules do not know which store they run on (chapter 5), and not every
store takes turns:

| Store | Without `guard` | With `guard` |
|---|---|---|
| Files, SQLite | Saves run one at a time. | The same. |
| Postgres, MySQL | Saves run side by side: two `after`s may count before either commits. | Saves that share a key take turns. |

A rule that holds on SQLite only by luck would break, unseen, the day `boards` moves to
Postgres (chapter 27). newt makes sure you never forget it, two ways.

**At compile time.** A save with `after` must name its `guard`, or it does not
compile. When an `after` checks no rule over rows, write `guard: []`: whoever reads
the save then sees that no guard is needed, rather than wondering whether one was
forgotten.

**At run time: the guard rule.** A save that guards nothing and still reads rows inside
its transaction (a `find` or a `count` in `before`, `write` or `after`) breaks the
guard rule, on every store, SQLite included. By default (`guardRule: 'error'`) the
save fails, and rolls back. Try it: write `guard: []` in `persistAdded`, and
`bun test cooper` fails with

```text
error: [guard rule] column.add reads column in a save that guards nothing: on Postgres and MySQL another save may change what it read before it commits. Name what its rule protects in the save's guard
```

A context can lower it to a warning, printed once per use case and table, with
`guardRule: 'warn'` in its `Base` options, or turn it off with `'off'`. cooper keeps
the default. What the rule looks at is only the save's own transaction: what a use
case reads before saving (the entity it loaded, its own check) is not its business,
nor is a query you write yourself on the store's connection.

Put the guard back before you go on.

## A board's name, once per workspace

A board's name is the same kind of rule, with "more than one" in place of "more than
ten". First its error, a 409:

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

### The save

In `board.repository.ts`, import the error:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
import { Board, type BoardDTO } from './board'
import { BoardNameTaken } from './errors/board-name-taken'
// …
```

Then add `persistWithNameFree` after `toEntity`:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
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
// …
```

`after` counts the boards with this name, `ieq` meaning equal whatever the case of A
to Z. The count includes the board just written, so more than one means it is taken.
The repository's scope limits the count to the current workspace, and `softDelete`
leaves archived boards out: an archived board's name is free again.

The key is per workspace and per name: two saves of `Roadmap` and `ROADMAP` in `acme`
take turns, and nothing else waits for them. Look at how the name is folded: only A to
Z, not with `toLowerCase()`. **The key must fold exactly as the rule compares.** `ieq`
and the unique index fold A to Z only, so for the rule `Ärger` and `ärger` are two
names, and their saves have nothing to wait for. Folding more (`toLowerCase()`) would
still be safe, only slower: different names would wait for each other. Folding
**less** than the comparison is the bug: two names the rule sees as one would get two
keys, and both would get in.

### The unique index: the last word

Chapter 5's migration already has the rule as an index:

```sql
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

It is partial (`WHERE deleted_at IS NULL`), so an archived board does not hold its
name. And the table tells every store the same thing, with the `unique` option of
`store.table`: no two rows (a softly deleted one aside) share a workspace and a name.
Change the constructor:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
      // Archiving stamps `deletedAt`: an archived board is in no list, and its name is free again.
      softDelete: true,
// …
```

SQLite ignores `unique`, since its indexes already say it; the files store, which has
no indexes, keeps it. A row that takes a unique value another row has is refused by
the store with `DuplicateValue`, a 409 (`duplicate_value`).

So on SQLite, in a race, the index usually answers first: the second `ROADMAP` is
refused as it is written, before its `after` runs. `DuplicateValue` is a kind of
`ConcurrencyConflict`, so the use case runs again, once (chapter 8 explains running
again), and this time its own check finds the name and answers `board.name_taken`.
The client gets the same answer either way. Each check has its job:

- **The use case's check**: the clear answer in the usual case.
- **The save's `after`, under its guard**: the rule, kept the same way on every
  store, whatever indexes it has.
- **The unique index**: the database's last word. Whatever writes the table, two rows
  of one name never both get in.

A board's column limit has no index to back it: no index can say "ten at most". There
the `after` is the only guarantee.

### The module

`board.module.ts` imports the error and the value object:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import type { Board_Deps } from './board.deps'
import { Board_Repository } from './board.repository'
import { registerBoardRoutes } from './board.routes'
import { BoardNameTaken } from './errors/board-name-taken'
import { BoardNotFound } from './errors/board-not-found'
import { BoardName } from './value-objects/board-name'
// …
```

`create` checks the name first, for the clear answer, then saves with
`persistWithNameFree`. A new use case, `findByName`, finds a board by its name,
whatever its case, for other modules (a later chapter uses it):

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  /** For other modules: the board with this name, whatever its case, if there is one. */
  @UseCase()
  async findByName(name: string): Promise<BoardDTO | null> {
    const board = await this.repo.first({ name: { ieq: BoardName.from(name) } })
    return board?.toDTO() ?? null
  }

  @UseCase()
  async create(input: unknown): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    await this.assertNameFree(BoardName.from(name))
    const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }
// …
```

`update` saves the same way, so a rename cannot take a name either. Its check leaves
out the board itself: renaming `Roadmap` to `ROADMAP` is fine.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  /** Renames it, describes it, or both. */
  @UseCase()
  async update(id: string, input: unknown): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(BoardName.from(changes.name), id)
    board.update(changes)
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }
// …
```

`archive` keeps plain `persist`: archiving frees a name, it never takes one. Add the
check after `load`, at the end of the class:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
// …
  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }

  /** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
  private async assertNameFree(name: BoardName, exceptId?: string): Promise<void> {
    if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
  }
}
```

`id: { ne: exceptId }` is left out when `exceptId` is `undefined`: a field or an
operator set to `undefined` is no condition, so an optional filter needs no `if`.

Last, the entity's comment on `archive` says what it now means:

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
  /** Out of every list, its name free again; its row stays, with what points at it. */
  archive(): void {
    this.markAsDeleted()
  }
// …
```

### Its tests

In `board.test.ts`, replace the test `renames a board, describes it, or both` and the
archive test with these. The second is the race on names; the third checks that only
A to Z are folded; the last, that an archived board frees its name.

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
// …
  test('gives a name to one board of a workspace, whatever its case; another workspace has its own', async () => {
    await create('Roadmap')

    await expect(create('ROADMAP')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await t.as('bea', 'globex', () => t.modules.board.create({ name: 'roadmap' }))).workspaceId).toBe('globex')

    const bugs = await create('Bugs')
    await expect(inAcme(() => t.modules.board.update(bugs.id, { name: 'roadMAP' }))).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.update(bugs.id, { description: 'What is broken' }))).description).toBe('What is broken')
  })

  test('gives a name to one of several boards created with it at once, whatever its case', async () => {
    const created = await Promise.allSettled(['Roadmap', 'ROADMAP', 'roadmap', 'RoadMap'].map(create))

    expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(1)
    for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
  })

  test('folds only A to Z when comparing names: letters beyond them are told apart by their case', async () => {
    await Promise.all([create('Ärger'), create('ärger')])

    await expect(create('äRGER')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(2)
  })

  test('archives a board: out of every list, and its name free again', async () => {
    const roadmap = await create('Roadmap')

    await inAcme(() => t.modules.board.archive(roadmap.id))

    await expect(inAcme(() => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
    expect((await create('Roadmap')).id).not.toBe(roadmap.id)
  })
// …
```

And over HTTP, in `boards.context.test.ts`, the board test also adds two columns and
tries a taken name:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board and its columns', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id
    for (const name of ['To do', 'Done']) expect((await call('POST', `/acme/boards/${id}/columns`, { name })).status).toBe(201)
    expect((await call<{ name: string }[]>('GET', `/acme/boards/${id}/columns`)).body.map(column => column.name)).toEqual(['To do', 'Done'])
    expect(await call('POST', '/acme/boards', { name: 'ROADMAP' })).toMatchObject({ status: 409, body: { code: 'board.name_taken' } })
// …
```

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

Start the server (`bun cooper/backend/index.ts`; the new migration is applied as it
opens), and in another terminal create a board, then another with the same name in
capitals:

```sh
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"Launch"}' localhost:3002/api/workspaces/acme/boards
# {"id":"01a1…","workspaceId":"acme","name":"Launch",…}
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"LAUNCH"}' localhost:3002/api/workspaces/acme/boards
# {"error":"There is a board called LAUNCH in this workspace already","code":"board.name_taken"}
```

Add a column to the first board (put its id in place of `<board>`), and list them:

```sh
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"To do"}' localhost:3002/api/workspaces/acme/boards/<board>/columns
# {"id":"01a1…","workspaceId":"acme","boardId":"<board>","name":"To do","position":0,…}
curl -H 'x-user: ana' localhost:3002/api/workspaces/acme/boards/<board>/columns
# [{"id":"01a1…","workspaceId":"acme","boardId":"<board>","name":"To do","position":0,…}]
```

Add nine more, and the eleventh is refused:

```sh
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"One more"}' localhost:3002/api/workspaces/acme/boards/<board>/columns
# {"error":"Board <board> has 10 columns already: that is the most a board has","code":"column.too_many"}
```

## What to remember

- A version protects one row. A rule over several rows is checked in the save's
  `after`, in its transaction, after the writes: throwing rolls it all back.
- The save names what the rule protects in `guard`, with keys as narrow as the rule
  (per board, per workspace and name). Saves that share a key never run side by side,
  on any store. Fold a key exactly as the rule compares.
- `before` reads and writes what must go first (a new column's place), where nothing
  slips in.
- A save with `after` must name its `guard` (`guard: []` when none is needed), and
  the guard rule refuses, by default, a save that reads rows and guards nothing.
- Check first in the use case too, for the clear answer; when an index can say the
  rule, it has the last word (`DuplicateValue`).

Next: [Cards and a shared counter](./07-cards-and-a-counter).
