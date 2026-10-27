# The first module: boards

`boards` is open and serves its health, and does nothing else. This chapter gives it
its first **module**, `board`: one responsibility of the context, with its data, the
rules about that data, and the things you can ask of it. You can create a board, read
it, rename it or describe it, and archive it when nobody needs it any more.

It is small, but it has every piece a module has, and every other module of cooper is
written the same way. These are its files, all inside
`cooper/backend/contexts/boards/modules/board/`:

```
board/
  board.schema.ts            the contract: what goes in and what comes out
  value-objects/
    board-name.ts            a board's name, with its own rules
  errors/                    what can go wrong
    invalid-board-name.ts
    board-not-found.ts
  board.ts                   the entity
  board.repository.ts        how it is kept
  board.module.ts            its use cases
  board.routes.ts            its HTTP API
  board.test.ts              its tests
```

A board has no workspace yet: everyone sees every board. Chapter
[4](./04-who-and-where) puts each board in a workspace.

You type every file here. In a project of your own,
`bunx newt add module <context-folder> <name>` writes a skeleton of these files to
start from
([appendix G](./g-command-line)).

## zod

Every piece of data in newt is described with [zod](https://zod.dev). Add it to the
root `package.json`, at an exact version:

```sh
bun add zod@4.3.6 --exact
```

The root `package.json` now depends on it beside newt:

```json
  "dependencies": {
    "newt": "workspace:*",
    "zod": "4.3.6"
  },
```

## The contract

Everything starts by describing the data. The schema file is the module's **public
contract**: what goes into its use cases and what comes out of them.

```ts
// cooper/backend/contexts/boards/modules/board/board.schema.ts
import { z } from 'zod'
import { BoardName } from './value-objects/board-name'

export const BoardSchema = z.object({
  id: z.uuidv7(),
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
- **The id is a UUIDv7.** The entity gives it, with `createdAt` and `updatedAt`; nobody
  sends them. Their `default('')` lets the entity be checked before it stamps its
  dates.
- **The input schemas** (`Create`, `Update`) have only what a client may send.
  They reuse the rules of the whole one: the description is trimmed, then `pipe`d
  into `BoardSchema.shape.description`, so "at most 500 characters" is written once.
  The name is taken as a plain string: the value object below decides what a name is.
- Everything the file exports starts with the entity's name (`Board…`).

## A value with rules: `BoardName`

A board's name is trimmed, has one space between words, and has 1 to 60 characters,
so ` Road  map ` and `Road map` are the same name. A **value object** keeps those rules
in one place: a type and a constant with the same name.

First the error it throws when a name cannot be one. The base class an error extends
decides the HTTP status; `ValidationError` is a 400:

```ts
// cooper/backend/contexts/boards/modules/board/errors/invalid-board-name.ts
import { ValidationError } from 'newt/contract'

export class InvalidBoardName extends ValidationError {
  readonly code = 'board.invalid_name'
  constructor(value: string) {
    super(`'${value}' is not a board's name: it has 1 to 60 characters`)
  }
}
```

Then the value object:

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
import type { ValueObject } from 'newt/contract'
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

- **`from`** turns what someone typed into the value, or throws `InvalidBoardName`.
  It is forgiving: `'  Road   map '` becomes `'Road map'`.
- **`schema`** describes how the value is **kept**. It is strict: it fixes nothing, and
  refuses a name that is not tidy already. It goes in the entity's schema.

`satisfies ValueObject<BoardName, string>` checks that the constant has both halves
with the right types.

**The type is branded.** At runtime a `BoardName` is a `string`. To TypeScript, a plain
`string` is not a `BoardName` until it goes through `BoardName.from` or
`BoardName.schema`. A field typed `BoardName` cannot be given an untidy name by
mistake.

Both imports come from `newt/contract`, not `newt/core`. `newt/contract` is the part of
newt a backend and its clients share, safe to load in a browser: value objects and
their errors, pages, the body of an error. The board's name will be checked the same
way in the web app (chapter [23](./23-frontends)).

## The entity

The entity is the schema **plus its behaviour**. It keeps its data valid, knows what
changed, and is the only one that changes it.

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
import { Entity, type EntityInput } from 'newt/core'
import { BoardSchema, type BoardDTO } from './board.schema'
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

  /** A new one: the name as someone typed it becomes a `BoardName`. */
  static create(input: { name: string, description: string }): Board {
    return new Board({ ...input, name: BoardName.from(input.name) }, true)
  }

  get name(): BoardName {
    return this.data.name
  }

  update(changes: { name?: string, description?: string }): void {
    this.change({
      ...(changes.name === undefined ? {} : { name: BoardName.from(changes.name) }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
    })
  }

  /** Out of every list; its row stays, with what points at it. */
  archive(): void {
    this.markAsDeleted()
  }
}
```

What `Entity`, from `newt/core`, gives you and guarantees:

- **Two doors in.** `create` for something new, `fromDTO` for something read from the
  store. The third argument of the constructor, `isNew`, is decided by the door, never
  by whether there is an id. The constructor is private: there is no other door.
- **A new one gets its id and dates on its own**: a UUIDv7, `createdAt` and
  `updatedAt`. `EntityInput<BoardDTO>` is the DTO with those three optional.
- **One read from the store comes with its `version`**, and cannot be built without it.
  The version starts at 0, and every save that writes the entity moves it on. Never
  touch it: chapter [8](./08-two-people-one-card) shows what it protects.
- **It is always valid.** It is checked against its schema when it is built and on
  every change. An entity that fails its own schema is a bug, not a client's mistake:
  chapter [3](./03-pages-and-errors) shows what the client gets.
- **Only the entity changes itself.** `change()` and `data` are protected. A use case
  calls `update()` or `archive()`, methods with business names. `change()` checks the
  whole entity, keeps the values the schema gives back, ignores what does not really
  change, and moves `updatedAt` when something does.
- **Its methods take business data, not the input DTO.** `create` takes
  `{ name, description }`, already checked by the use case. Here they look alike; in
  chapter [4](./04-who-and-where) the board is also given its workspace, which no
  client sends.
- **`markAsDeleted()`** says the entity is gone. What "gone" means is the repository's
  choice: you will make it a soft deletion below. A deleted entity cannot change again.
- **Outside its module an entity does not exist.** Use cases return `toDTO()`. The
  getter `name` is for the module's own code.

`board.ts` re-exports the schema file, so the module imports the entity and its
contract from one place.

## The repository

The repository is **the only thing** that reads and writes boards. When each entity is
a row of one table, as here, extend `TableRepository` from `newt/repository` and say how
a row becomes an entity:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { Board, type BoardDTO } from './board'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board'), {
      // Archiving stamps `deletedAt`: an archived board is in no list.
      softDelete: true,
      // No scope yet: chapter 4 gives the boards their workspace's.
      scope: 'none',
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }
}
```

With that you already have `find`, `first`, `count`, `page` and `persist`:

- **`base.store.table<BoardRow>('board')`** is the table, in the context's store. On
  the file store it is the folder `board/`, one JSON file per board. The row is the
  DTO, its `version`, and its `deletedAt`.
- **`softDelete: true`** turns the deletion `archive()` asks for into a `deletedAt`
  stamp. The row stays, because columns and cards will point at it; archived boards
  drop out of every `find`, `count` and `page`.
- **`scope`** says whose rows these are. Every repository has to say it, or it does
  not compile: either a scope (the workspace a request is in, from chapter
  [4](./04-who-and-where)) or `'none'`, written out. For now there are no workspaces,
  so the boards say `'none'`, with a comment that says until when.
- **`persist(...entities)`** saves one or more boards at once, all or none: one
  transaction. It writes only what changed.
- **What to find is said with criteria**, field by field: `this.repo.find({ id })` is
  "the boards whose id is this one". Every store understands them.

## Not found

Asking for a board that is not there is the second thing that can go wrong.
`NotFoundError` is a 404:

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

The errors of a module live in its `errors/` folder, one per file. The `code` is
`<module>.<what>`, and it never changes: a client decides what to do from it. The
message is for a person to read.

## The module and its use cases

The module puts it all together: it holds the repository, and each thing you can ask
of it is a **use case**.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import {
  Board,
  BoardCreateSchema,
  BoardUpdateSchema,
  type BoardDTO,
} from './board'
import { Board_Repository } from './board.repository'
import { registerBoardRoutes } from './board.routes'
import { BoardNotFound } from './errors/board-not-found'

/** The boards. */
export class Board_Module extends Module {

  static initialize(base: BoardsBase): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base))
    registerBoardRoutes(base, module)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Board_Repository) {
    super('board', base.invocations)
  }

  @UseCase()
  async get(id: string): Promise<BoardDTO> {
    return (await this.load(id)).toDTO()
  }

  @UseCase()
  async create(input: unknown): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    const board = Board.create({ name, description })
    await this.repo.persist(board)
    return board.toDTO()
  }

  /** Renames it, describes it, or both. */
  @UseCase()
  async update(id: string, input: unknown): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    board.update(changes)
    await this.repo.persist(board)
    return board.toDTO()
  }

  /** Out of every list for good; its columns and cards stay, pointing at it. */
  @UseCase()
  async archive(id: string): Promise<void> {
    const board = await this.load(id)
    board.archive()
    await this.repo.persist(board)
  }

  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }
}
```

- **`super('board', base.invocations)`** names the module. **`@UseCase()`** makes each
  public method a use case named after both: `board.create`, `board.update`. Each call
  is an invocation the base records; those names are what you will see in traces and
  in queue names. Every public method of a module is a use case: one without
  `@UseCase()` is a lint error (`newt/use-case`), and what is not a use case is
  `private`, as `load` is.
- **A module given deps passes them to `super` too**, as a third argument:
  `super('board', base.invocations, deps)`. board has none yet; it gets its first in
  [chapter 4](./04-who-and-where). newt keeps them in the context's registry, so the
  running application can tell what each module depends on
  ([appendix H](./h-describe-application)).
- **The input is `unknown`.** `create` and `update` take whatever they are handed and
  parse it: `BoardCreateSchema.parse(input)` is what gives it a type. A route, a test
  or another context can pass anything; the use case is the one that checks.
- **`static initialize`** creates the module and registers its routes. It is what the
  context calls. The constructor is private.
- **Every use case has the same shape**: validate the input at the door
  (`BoardCreateSchema.parse`), load, let the entity change itself, `persist` once,
  return DTOs. The use case holds no transaction: the `persist` is one.
- **`this.resolve(find, onMissing)`** turns a search into one entity or an error you
  choose: here `BoardNotFound`, a 404, because the id is the resource asked for.

## The routes

A route reads the request, calls a use case and answers. **Nothing more.** All the
logic lives in the use case, so it works the same from HTTP, from a test, from a
script, and later from an MCP tool.

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
import type { BoardsBase } from '../../boards-base'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module): void {
  base.http.post('/boards', async request => Response.json(await boards.create(await request.json()), { status: 201 }))

  base.http.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))

  base.http.patch('/boards/:boardId', async request => Response.json(await boards.update(request.params.boardId, await request.json())))

  base.http.post('/boards/:boardId/archive', async request => {
    await boards.archive(request.params.boardId)
    return new Response(null, { status: 204 })
  })
}
```

- Every route hangs from `/api`: `/boards` is `/api/boards`.
- **The path types its parameters**: in `/boards/:boardId`, `request.params.boardId`
  exists and is a `string`.
- **There is no `try/catch`.** If the use case throws `BoardNotFound`, the router
  answers 404 with `{ error, code }`. The next chapter shows every answer.
- **The body goes to the use case as it came**: `await request.json()`, with no
  `as BoardCreateDTO`. A cast is not a check, only a type the editor believes, and
  the use case parses anyway. The lint refuses one (`newt/route-body`), so no route
  pretends to know what a client sent.

## Registering it

The context creates its modules in `initializeModules`, each one after the modules it
uses. `board` uses none:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config) {
  const board = Board_Module.initialize(base)
  return { board }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

`boards.modules.board` is now the module, typed: `boards.modules.board.create({ name:
'Roadmap' })` is a use case call.

## Who is asking

Every route of the router needs someone signed in, unless it is registered with
`{ public: true }` (the health is). The router asks its **authenticator** who sent each
request: a function that takes the request and gives back the actor, `{ userId }`, or
`null`. With `null`, the route is not run and the answer is a 401, `not_signed_in`.
With an actor, the route runs as that actor, and any use case it reaches can ask who
is acting (chapter [4](./04-who-and-where)).

Signing in for real is chapter [22](./22-web-session). Until then, whoever sends a
request says who they are in an `x-user` header. One line of `index.ts` sets it, after
the context opens:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'

const boards = await Boards_Context.open(config.boards)
// For now, who sends a request says who they are in an `x-user` header (chapter 22 signs them in).
boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId } : null
})
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
```

## Testing it

Every test needs `boards` open in a folder of its own, with the same authenticator.
That goes in one helper, in the context's `testing/` folder:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../../../config'
import { Boards_Context } from '../boards.context'

/**
 * `boards` for a test: its files in a folder of its own, removed as it closes, and
 * who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
  const boards = await Boards_Context.open({ ...config.boards, folder, port: 0 })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId } : null
  })
  return {
    boards,
    modules: boards.modules,
    folder,
    async close(): Promise<void> {
      await boards.stop()
      await rm(folder, { recursive: true, force: true })
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

The module's own test calls its use cases directly, as a route would. It sits next to
the module:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

describe('board', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
  })

  afterEach(() => t.close())

  const create = (name: string) => t.modules.board.create({ name })

  test('keeps a name as a board\'s name: trimmed, one space between words, 1 to 60 characters', async () => {
    expect(String((await create('  Road   map ')).name)).toBe('Road map')
    await expect(create('   ')).rejects.toMatchObject({ code: 'board.invalid_name' })
    await expect(create('x'.repeat(61))).rejects.toMatchObject({ code: 'board.invalid_name' })
  })

  test('renames a board, describes it, or both', async () => {
    const bugs = await create('Bugs')

    expect(await t.modules.board.update(bugs.id, { description: 'What is broken' })).toMatchObject({ name: 'Bugs', description: 'What is broken' })
    expect(String((await t.modules.board.update(bugs.id, { name: ' Known  bugs ' })).name)).toBe('Known bugs')
    expect(String((await t.modules.board.get(bugs.id)).name)).toBe('Known bugs')
  })

  test('archives a board: it is not found any more', async () => {
    const roadmap = await create('Roadmap')

    await t.modules.board.archive(roadmap.id)

    await expect(t.modules.board.get(roadmap.id)).rejects.toMatchObject({ code: 'board.not_found' })
  })
})
```

The context's test moves to the helper, and goes through HTTP: a request without
`x-user` is a 401, and a board is a file of its own, which you can read back. Replace
`boards.context.test.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { join } from 'node:path'
import { serve } from 'newt/http'
import { openTestBoards, type TestBoards } from './testing/open-test-boards'

describe('boards, through its API', () => {
  let t: TestBoards
  let server: Server<undefined>

  beforeEach(async () => {
    t = await openTestBoards()
    server = serve(t.boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await t.close()
  })

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, user: string | null = 'ana') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (user) headers['x-user'] = user
    const response = await fetch(new URL(`/api${path}`, server.url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
  }

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('lets in only who says who they are', async () => {
    expect(await call('POST', '/boards', { name: 'Roadmap' }, null)).toMatchObject({ status: 401, body: { code: 'not_signed_in' } })
  })

  test('keeps a board as a file of its own, and gives it back', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id

    expect(await Bun.file(join(t.folder, 'board', `${id}.json`)).json()).toMatchObject({ id, name: 'Roadmap', version: 1 })
    expect((await call('PATCH', `/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })
})
```

## Check it

Run the gate:

```sh
bun install && bun check && bun test cooper && bun run lint
```

```
 6 pass
 0 fail
```

Start the backend, and from another terminal create a board as Ana:

```sh
bun cooper/backend/index.ts
```

```sh
curl -s -X POST localhost:3002/api/boards -H 'content-type: application/json' \
  -H 'x-user: ana' -d '{"name":"Roadmap"}'
```

It answers 201 with the board:

```json
{"id":"01a1794b-12cb-7140-8329-cfe6ac61de46","name":"Roadmap","description":"","createdAt":"2026-10-26T17:38:45.579Z","updatedAt":"2026-10-26T17:38:45.579Z"}
```

The same request without `x-user`:

```json
{"error":"Sign in to continue","code":"not_signed_in"}
```

And the board is a file of its own:

```sh
ls data/boards/board/
```

```
01a1794b-12cb-7140-8329-cfe6ac61de46.json
```

```sh
cat data/boards/board/01a1794b-12cb-7140-8329-cfe6ac61de46.json
```

```json
{
  "id": "01a1794b-12cb-7140-8329-cfe6ac61de46",
  "name": "Roadmap",
  "description": "",
  "createdAt": "2026-10-26T17:38:45.579Z",
  "updatedAt": "2026-10-26T17:38:45.579Z",
  "deletedAt": null,
  "version": 1
}
```

Your ids and dates will be others. Archive it, with its id:

```sh
curl -s -i -X POST localhost:3002/api/boards/01a1794b-12cb-7140-8329-cfe6ac61de46/archive -H 'x-user: ana'
```

It answers `204 No Content`. The file stays, at version 2, with `deletedAt` set; a
`GET` of the board is now a 404:

```json
{"error":"There is no board 01a1794b-12cb-7140-8329-cfe6ac61de46","code":"board.not_found"}
```

## What to remember

- A module is one responsibility, and always the same files: schema, entity, value
  objects, errors, repository, module, routes, tests.
- The schema is the contract. Input schemas have only what a client sends, and reuse
  the rules of the whole one.
- A value object keeps a value's rules in one place: `from` forgives what someone
  typed, `schema` is strict about what is kept, and the brand keeps the two apart.
- Only the entity changes itself; only the repository touches the store. A use case
  validates, loads, changes, persists once and returns DTOs.
- A use case takes its input as `unknown` and parses it; a route passes the body as
  it came. Every public method of a module is a `@UseCase()`.
- A route does not think. Who sends a request is the authenticator's business, never
  the route's.
- Every repository states its `scope`, even when it is `'none'`.

Next: [use cases, pages and errors](./03-pages-and-errors).
