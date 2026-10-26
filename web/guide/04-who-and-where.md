# Who and where

So far anyone who sends an `x-user` header sees every board. cooper is a SaaS: a board
belongs to a **workspace**, and only the people of that workspace may reach it. Every
request has to answer two questions before any use case runs:

- **Who is acting?** The actor: the person the request runs as, and how they came in.
- **Where?** The workspace the request is about: a scope that every repository of
  `boards` reads and writes within.

And a third one, asked every time and never written down: **may they?** Is this
person a member of that workspace?

In this chapter boards move under `/api/workspaces/:workspaceId/…`. A member gets in;
anyone else gets a 404, as if the workspace did not exist. Who belongs to which
workspace is `auth`'s business, and there is no `auth` yet (it comes in chapter 17).
So `boards` asks through a **port** of its own, and for now a fake answers it.

We do this before moving to SQLite (chapter 5) on purpose: the board gains a field,
and with files that needs no migration.

## The actor: who, and how they came in

newt knows one thing about the actor: its `userId`. An application that needs more
**augments** newt's `Actor` interface, once, in a file every program loads. cooper adds
how someone came in: through its web apps, or through an AI assistant over MCP
(chapter 24).

```ts
// cooper/backend/shared/actor.ts
import 'newt/core'

/**
 * How someone reached cooper: its web apps, with a session cookie, or an AI assistant
 * through boards' MCP server, with an access token.
 */
export type ActorVia = 'web' | 'mcp'

// newt knows one thing of the actor, its user. cooper adds how they came in, once,
// here: every program loads it through `CooperBase`. Required, so every place that
// says who acts says it too (`authenticateWith`, `runAsActor`): who someone is, never
// what they may do.
declare module 'newt/core' {
  interface Actor {
    via: ActorVia
  }
}
```

The field is **required**. From now on every place that says who acts must say `via`
too, or it does not compile: the authenticator, and `runAsActor` in tests and
scripts. The compiler finds every one of them for you.

Keep the actor to who someone is and how they came. Never put what they may do in it
(their workspaces, a role): a permission taken away would still be in every actor
already made. What they may do is asked, every time, of the module that knows.

Load the file from `CooperBase`, so every context has it. Add one line to the imports:

```ts
// cooper/backend/shared/cooper-base.ts
import type { FileStore } from 'newt/adapter-files'
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import './actor'
// …
```

Any use case, however deep, reads the actor with `currentActor()` from `newt/core`.
Outside any actor it throws `NoActor`, which answers 401. newt also has
`findCurrentActor()`, which returns `undefined` instead of throwing: for something
anyone may do, where a signed-in person sees more. `boards` does not need it; cooper
uses it in chapter 21.

## A port: what boards asks of auth

`boards` must know whether someone belongs to a workspace. The answer lives in another
context. A module of `boards` must not import `auth`'s code, so it says what it needs
**in its own words**, as a type, and whoever opens the context hands it an
implementation. That is a port.

The `member` module owns it. Its `.deps.ts` file says what the module receives:

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
/**
 * What `boards` needs to know of the workspaces, and asks whoever keeps them (auth's
 * tenants and access): a port, in boards' own words, so this module depends on no
 * module of auth. The context is handed one when it opens; a test, a fake.
 */
export type Workspaces = {
  /** Whether someone belongs to a workspace now, deleted it has nobody: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
}

export interface Member_Deps {
  workspaces: Workspaces
}
```

It has one method for now. Later chapters add more (who a member is, whether a
workspace exists).

`boards` also has a picture of a member: who they are and where to write to them. The
fake below builds them, and later chapters show them:

```ts
// cooper/backend/contexts/boards/modules/member/member.schema.ts
import { Email } from 'newt/contract'
import { z } from 'zod'

/** Someone who belongs to a workspace, as `boards` sees them: who they are, and where to write to them. auth keeps them. */
export const MemberSchema = z.object({
  /** Their user's id, in auth. */
  id: z.string(),
  name: z.string(),
  email: Email.schema,
})

export type MemberDTO = z.infer<typeof MemberSchema>
```

Someone who is not a member gets a 404, not a 403. A private thing does not own up to
existing: a 403 would tell a stranger that workspace `acme` is there.

```ts
// cooper/backend/contexts/boards/modules/member/errors/workspace-not-found.ts
import { NotFoundError } from 'newt/core'

/** A workspace the person does not belong to, or that does not exist: to them, the same thing. */
export class WorkspaceNotFound extends NotFoundError {
  readonly code = 'workspace.not_found'
  constructor(id: string) {
    super(`There is no workspace ${id}`)
  }
}
```

## The workspace scope

The actor travels with the work: you never pass the user's id from hand to hand. The
workspace should travel the same way. newt gives you `defineScope` for any value like
that. A scope has `run(value, fn)`, which runs `fn` inside it; `current()`, which
returns the value or throws outside it (with the error you give as `missing`); and
`find()`, which returns `undefined` instead.

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
import { defineScope } from 'newt/core'
import type { Member_Module } from './modules/member/member.module'

/** The workspace the work in progress is about: an auth tenant, by its id. */
export type WorkspaceScope = {
  workspaceId: string
}

/**
 * The workspace scope. A request under `/api/workspaces/:workspaceId` enters it once
 * its person is checked to belong (`workspaceRoutes`), and so does an MCP tool
 * (`inWorkspace`); a worker or a script, which knows its workspace already, enters it
 * with `runInWorkspace`. Every repository of `boards` sees only its rows.
 */
export const workspaceScope = defineScope<WorkspaceScope>('workspace', {
  missing: () => new Error('No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one'),
})

/** The id of the workspace the work in progress is about; throws outside one. */
export function currentWorkspaceId(): string {
  return workspaceScope.current().workspaceId
}

/** Runs in a workspace without checking who may: for workers and scripts, which already know. */
export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return workspaceScope.run({ workspaceId }, fn)
}

/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
```

There are two ways in. `inWorkspace` checks that the person signed in belongs to the
workspace; `runInWorkspace` checks nothing, for workers and scripts that already know
which workspace their work is about.

The check itself is a use case of `member`. It asks the port, every time, with the
actor's id, and returns the scope to enter:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
import { currentActor, Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import type { WorkspaceScope } from '../../workspace-scope'
import { WorkspaceNotFound } from './errors/workspace-not-found'
import type { Member_Deps } from './member.deps'

/**
 * Who belongs to each workspace, as `boards` asks it: the module that knows,
 * asked every time, never written in the actor. It keeps nothing: auth keeps the
 * workspaces and their members, and answers through the `Workspaces` port.
 */
export class Member_Module extends Module {

  static initialize(base: BoardsBase, deps: Member_Deps): Member_Module {
    return new Member_Module(base, deps)
  }

  private constructor(base: BoardsBase, private readonly deps: Member_Deps) {
    super('member', base.invocations)
  }

  /**
   * The workspace scope for the signed-in person, if they belong to it: what a route
   * under `/workspaces/:workspaceId` runs in. To anyone else it does not exist (404,
   * not 403: a private thing does not own up to existing).
   */
  @UseCase()
  async enter(workspaceId: string): Promise<WorkspaceScope> {
    if (!await this.deps.workspaces.isMember(workspaceId, currentActor().userId)) throw new WorkspaceNotFound(workspaceId)
    return { workspaceId }
  }
}
```

`member` has no repository and no table: it keeps nothing. It is the one place in
`boards` that knows how membership is asked.

## Routes under a workspace: a group with a middleware

Every route about a workspace must enter its scope, and no route may forget the
membership check. Rather than calling `inWorkspace` in each route, you register them
on a **group**. `http.group(prefix, middleware)` returns a router for the routes under
`prefix`. Its middleware runs around each of them, after the session is checked: it
may answer instead, or go on with `next()`, here inside the workspace scope. A route's
params are its group's and its own.

```ts
// cooper/backend/contexts/boards/workspace-routes.ts
import type { BoardsBase } from './boards-base'
import type { Member_Module } from './modules/member/member.module'
import { workspaceScope } from './workspace-scope'

/**
 * The routes about one workspace, under `/api/workspaces/:workspaceId`: each one runs
 * in that workspace once `member.enter` has checked the signed-in person belongs to it
 * (404 for anyone else), so no use case below has to, nor can forget to. Every module
 * of `boards` registers its routes on it.
 */
export function workspaceRoutes(base: BoardsBase, members: Member_Module) {
  return base.http.group('/workspaces/:workspaceId', async (request, next) =>
    workspaceScope.run(await members.enter(request.params.workspaceId), next))
}
```

If `enter` throws `WorkspaceNotFound`, the route never runs, and the router answers
the 404 as it answers any domain error.

## A board belongs to a workspace

The board gains a `workspaceId`. Add it to the schema, after `id`:

```ts
// cooper/backend/contexts/boards/modules/board/board.schema.ts
export const BoardSchema = z.object({
  id: z.uuidv7(),
  /** The workspace it is in: an auth tenant, by id. */
  workspaceId: z.string(),
  name: BoardName.schema,
// …
```

It is an id and nothing more: the workspace is another context's, so a board points at
it and never holds it.

The entity takes it when it is created, and shows it. Replace `create` and add the
getter before `name`:

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
  /** A new one, in its workspace: the name as someone typed it becomes a `BoardName`. */
  static create(input: { workspaceId: string, name: string, description: string }): Board {
    return new Board({ ...input, name: BoardName.from(input.name) }, true)
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }
// …
```

### The repository's scope

Now the important part. In chapter [2](./02-first-module) the repository said
`scope: 'none'`, because there were no workspaces. A repository whose rows belong to a
workspace says so **once**, in that same option: the field that holds the workspace,
and a function that gives the current one. Replace `'none'` with them, and add the
import:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Board, type BoardDTO } from './board'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board'), {
      // Archiving stamps `deletedAt`: an archived board is in no list.
      softDelete: true,
      // Every find, count and page sees the current workspace's boards only.
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }

  /**
   * The boards created last, in every workspace: for the staff, who look across them
   * on purpose. Archived ones stay out.
   */
  recentInEveryScope(limit: number): Promise<Board[]> {
    return this.findInEveryScope({}, { limit, orderBy: [{ field: 'id', direction: 'desc' }] })
  }
}
```

The option's type is `RepositoryScope<Row> | 'none'`, from `newt/repository`.
A `RepositoryScope` is `{ field, current }`: `field` is a column of the row
(`'workspaceId'`; a name the row does not have does not compile), and `current` gives
the scope's value for the work in progress. The option is not optional. A repository
that leaves `scope` out does not compile, so a scope is never lost by forgetting it:
dropping one means writing `'none'`, where a review sees it.

What `scope` guarantees:

- `find`, `first`, `count` and `page` see only the current workspace's rows. No query
  of the module can forget the filter.
- Saving an entity of another workspace, or one stored in another, throws.
- Outside a workspace, `currentWorkspaceId()` throws, so a worker or a script has to
  enter one first.

So `board.get(id)` with the id of another workspace's board finds nothing: a
`board.not_found`, the same answer as an id that does not exist.

Sometimes looking across workspaces is the point: cooper's staff backoffice (chapter
25) shows the boards created last, wherever they are. That goes through the protected
`findInEveryScope`, behind a method whose name says so, `recentInEveryScope`. A review
finds every such place by its name.

### The module

`board` now needs `member`, to build its workspace routes. A module says what it
receives from other modules in its `.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/board/board.deps.ts
import type { Member_Module } from '../member/member.module'

export interface Board_Deps {
  /** Who may enter each workspace: its routes run in the workspace scope it gives. */
  member: Member_Module
}
```

In `board.module.ts`, import the workspace helpers and the deps:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import { mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
// …
import type { Board_Deps } from './board.deps'
import { Board_Repository } from './board.repository'
// …
```

Then `initialize` takes the deps and hands them to the routes, and the class comment
says where its use cases run:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
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
// …
```

`list`, `get`, `update` and `archive` do not change at all: the repository's scope does
the work. Only its comment says "the workspace's":

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  /** A page of the workspace's boards, the newest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<BoardDTO>> {
    return mapPage(await this.repo.page({}, page, { newestFirst: true }), board => board.toDTO())
  }

  /** For other contexts (the backoffice): a page of a workspace's boards, the newest first. */
  @UseCase()
  async listOf(workspaceId: string, page: PageRequest): Promise<Page<BoardDTO>> {
    return runInWorkspace(workspaceId, () => this.list(page))
  }

  /**
   * For the staff's backoffice: the boards created last, whatever their workspace. It
   * reads every workspace on purpose, so it does not run in one: no person of a
   * workspace reaches it (no route of boards calls it), and its repository says so by
   * name (`findInEveryScope`), where a review sees it.
   */
  @UseCase()
  async recentInEveryWorkspace(limit: number): Promise<BoardDTO[]> {
    const boards = await this.repo.recentInEveryScope(Math.min(Math.max(limit, 1), 50))
    return boards.map(board => board.toDTO())
  }
// …
```

The two new use cases, `listOf` and `recentInEveryWorkspace`, are for other contexts,
which have no workspace scope of their own: `listOf` names its workspace and enters it,
`recentInEveryWorkspace` looks across all of them. No route of `boards` calls either.

`create` stamps the new board with the current workspace. The client never sends it:
it comes from the URL, checked by the middleware.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  @UseCase()
  async create(input: unknown): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
    await this.repo.persist(board)
    return board.toDTO()
  }
// …
```

### The routes

The routes move from `base.http` to the workspace group. Their paths stay
`/boards…`; the group puts `/workspaces/:workspaceId` in front.

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Board_Deps } from './board.deps'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module, deps: Board_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  workspace.post('/boards', async request => Response.json(await boards.create(await request.json()), { status: 201 }))

  workspace.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))

  workspace.patch('/boards/:boardId', async request => Response.json(await boards.update(request.params.boardId, await request.json())))

  workspace.post('/boards/:boardId/archive', async request => {
    await boards.archive(request.params.boardId)
    return new Response(null, { status: 204 })
  })
}
```

## Wiring the context

`initializeModules` now receives what the modules need from outside the context: the
port. `member` comes first, since `board` uses it.

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'
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
  return { member, board }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

`Boards_Context.open` takes those deps and passes them on:

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { FileStore } from 'newt/adapter-files'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'

/**
 * The SaaS: each workspace's boards, their columns and cards. Its people belong to
 * workspaces that `auth` keeps: `boards` asks it through ports it is handed when it opens.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config) {
    super('boards', base, config)
  }

  static async open(config: Boards_Config, deps: Boards_ModuleDeps): Promise<Boards_Context> {
    const store = await FileStore.open({ folder: config.folder })
    const base = new BoardsBase({ name: 'boards', store })
    const modules = initializeModules(base, config, deps)
    return new Boards_Context(base, modules, config)
  }
}
```

## A fake auth

Until chapter 17 there is no `auth` to answer the port. A fake one, in memory, does.
It lives in `boards`' `testing` folder, and grows chapter by chapter as `boards` asks
more of `auth`:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
import { Email } from 'newt/contract'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'

/**
 * auth, as `boards` needs it before there is one: who belongs to each workspace,
 * kept in memory.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** The port of who belongs to each workspace. */
  readonly workspaces: Workspaces = {
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
  }

  private constructor() {}

  static async open(): Promise<FakeAuth> {
    return new FakeAuth()
  }

  /** Someone joins a workspace: `<userId>@cooper.test`, named after their id. */
  join(workspaceId: string, userId: string): MemberDTO {
    const member = { id: userId, name: userId, email: Email.from(`${userId}@cooper.test`) }
    const members = this.members.get(workspaceId) ?? new Map<string, MemberDTO>()
    members.set(userId, member)
    this.members.set(workspaceId, members)
    return member
  }
}
```

A workspace here is any id someone joined. There is no "create a workspace" yet: that
is `auth`'s too.

### Tests: who, and where

`openTestBoards` opens `boards` with a `FakeAuth` behind its port, returns it so a test
can say who belongs where, and gains `as(userId, workspaceId, fn)`: it runs `fn` as
that person, in that workspace, after the same membership check a route does.
`runAsActor` (from `newt/core`) runs a function as an actor, the way the router runs a
route; note the `via` it now has to give.

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { Boards_Context } from '../boards.context'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its files in a folder of its own, removed as it closes, a fake
 * auth behind its ports, and who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
  const boards = await Boards_Context.open({ ...config.boards, folder, port: 0 }, {
    workspaces: auth.workspaces,
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    folder,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    async close(): Promise<void> {
      await boards.stop()
      await rm(folder, { recursive: true, force: true })
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

The module tests now run each call as Ana, in `acme`. Bea is in `globex`, and the last
test checks she sees nothing of `acme`: not a board by its id (`board.not_found`), not
the list (`workspace.not_found`). `listOf`, which another context calls, needs no
actor at all.

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

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

  test('lists a workspace\'s boards by pages, the newest first', async () => {
    for (const name of ['Roadmap', 'Bugs', 'Launch']) await create(name)

    const first = await inAcme(() => t.modules.board.list({ size: 2 }))
    expect(first.items.map(board => String(board.name))).toEqual(['Launch', 'Bugs'])
    expect(first).toMatchObject({ hasMore: true, total: 3 })

    const next = await inAcme(() => t.modules.board.list({ size: 2, cursor: first.items[1]!.id }))
    expect(next.items.map(board => String(board.name))).toEqual(['Roadmap'])
    expect(next.hasMore).toBe(false)
  })

  test('keeps a name as a board\'s name: trimmed, one space between words, 1 to 60 characters', async () => {
    expect(String((await create('  Road   map ')).name)).toBe('Road map')
    await expect(create('   ')).rejects.toMatchObject({ code: 'board.invalid_name' })
    await expect(create('x'.repeat(61))).rejects.toMatchObject({ code: 'board.invalid_name' })
  })

  test('renames a board, describes it, or both', async () => {
    const bugs = await create('Bugs')

    expect(await inAcme(() => t.modules.board.update(bugs.id, { description: 'What is broken' }))).toMatchObject({ name: 'Bugs', description: 'What is broken' })
    expect(String((await inAcme(() => t.modules.board.update(bugs.id, { name: ' Known  bugs ' }))).name)).toBe('Known bugs')
  })

  test('archives a board: out of every list', async () => {
    const roadmap = await create('Roadmap')

    await inAcme(() => t.modules.board.archive(roadmap.id))

    await expect(inAcme(() => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
  })

  test('shows a workspace\'s boards to its members only, and nobody else\'s', async () => {
    const roadmap = await create('Roadmap')

    await expect(t.as('bea', 'globex', () => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    await expect(t.as('bea', 'acme', () => t.modules.board.list({ size: 10 }))).rejects.toMatchObject({ code: 'workspace.not_found' })
    expect((await t.modules.board.listOf('acme', { size: 10 })).items.map(board => board.id)).toEqual([roadmap.id])
  })
})
```

The HTTP test moves to `/api/workspaces/…`. Its `call` helper puts `/workspaces` in
front of every path, and each test names its workspace:

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
    t.auth.join('acme', 'ana')
    t.auth.join('globex', 'bea')
    server = serve(t.boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await t.close()
  })

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, user: string | null = 'ana') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (user) headers['x-user'] = user
    const response = await fetch(new URL(`/api/workspaces${path}`, server.url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
  }

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('lets only a workspace\'s members in, and tells nobody else it exists', async () => {
    expect((await call('GET', '/acme/boards', undefined, null)).status).toBe(401)
    expect(await call('GET', '/acme/boards', undefined, 'bea')).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
    expect(await call('GET', '/acme/boards')).toMatchObject({ status: 200, body: { items: [], total: 0 } })
  })

  test('keeps a board as a file of its own, and gives it back', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id

    expect(await Bun.file(join(t.folder, 'board', `${id}.json`)).json()).toMatchObject({ id, name: 'Roadmap', version: 1 })
    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/acme/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })

  test('shows a board to its workspace only', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id

    expect((await call('GET', `/globex/boards/${id}`, undefined, 'bea')).status).toBe(404)
  })

  test('lists boards by pages: ?size= and ?cursor=', async () => {
    for (const name of ['Roadmap', 'Bugs', 'Launch']) await call('POST', '/acme/boards', { name })

    const first = await call<{ items: { id: string, name: string }[] }>('GET', '/acme/boards?size=2')
    expect(first.body).toMatchObject({ items: [{ name: 'Launch' }, { name: 'Bugs' }], hasMore: true, total: 3 })
    expect((await call('GET', `/acme/boards?size=2&cursor=${first.body.items[1]!.id}`)).body).toMatchObject({ items: [{ name: 'Roadmap' }], hasMore: false })
  })

  test('answers what went wrong as { error, code }, with the status its error says', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id

    expect(await call('GET', `/acme/boards/${Bun.randomUUIDv7()}`)).toMatchObject({ status: 404, body: { code: 'board.not_found' } })
    expect(await call('POST', '/acme/boards', { name: ' ' })).toMatchObject({ status: 400, body: { code: 'board.invalid_name' } })
    expect(await call('PATCH', `/acme/boards/${id}`, { description: 'x'.repeat(501) })).toMatchObject({ status: 400, body: { code: 'validation', issues: [{ path: ['description'] }] } })
    expect(await call('GET', '/acme/nothing/here')).toMatchObject({ status: 404, body: { code: 'route_not_found' } })

    const malformed = await fetch(new URL('/api/workspaces/acme/boards', server.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'ana' }, body: '{ "name": ' })
    expect([malformed.status, (await malformed.json() as { code: string }).code]).toEqual([400, 'malformed_body'])
  })
})
```

## The dev server

`index.ts` opens a `FakeAuth` too, with Ana in `acme` and Bea in `globex`, and its
authenticator says `via: 'web'`. Replace the lines from the `setCooperMessages()` call
down to `boards.start()`, and add the import:

```ts
// cooper/backend/index.ts
import { Boards_Context } from './contexts/boards/boards.context'
import { FakeAuth } from './contexts/boards/testing/fake-auth'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()

// For now auth is a fake one, in memory: ana is in acme, bea in globex (chapter 17 brings the real one).
const auth = await FakeAuth.open()
auth.join('acme', 'ana')
auth.join('globex', 'bea')

const boards = await Boards_Context.open(config.boards, { workspaces: auth.workspaces })
// For now, who sends a request says who they are in an `x-user` header (chapter 22 signs them in).
boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId, via: 'web' as const } : null
})
// …
```

A program that is not a test importing from `testing/` is a stopgap, and says so in
its comment: chapter 20 takes it out.

## Telling the agents

The workspace scope is a convention of cooper's that newt's rules do not say: every
repository of `boards` is scoped by workspace. Add it to the conventions of
`cooper/AGENTS.md` (chapter [1](./01-project-and-context)), so a coding agent that adds
a module scopes its repository too:

```md
## Conventions

- Every context's base is a `CooperBase` (shared/cooper-base.ts); a module registers
  its routes on `base.http`, in its `<m>.routes.ts`.
- boards' repositories are scoped by workspace (contexts/boards/workspace-scope.ts).
```

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

Boards you created in earlier chapters have no workspace, so no workspace lists them.
Remove `data/boards` if you want a clean start. Then start the server:

```sh
bun cooper/backend/index.ts
```

In another terminal, Ana creates a board in `acme` and lists it:

```sh
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"Roadmap"}' localhost:3002/api/workspaces/acme/boards
# {"id":"01a1…","workspaceId":"acme","name":"Roadmap","description":"","createdAt":"…","updatedAt":"…"}
curl -H 'x-user: ana' localhost:3002/api/workspaces/acme/boards
# {"items":[{"id":"01a1…","workspaceId":"acme","name":"Roadmap",…}],"hasMore":false,"total":1}
```

Bea is not in `acme`. For her it does not exist:

```sh
curl -H 'x-user: bea' localhost:3002/api/workspaces/acme/boards
# {"error":"There is no workspace acme","code":"workspace.not_found"}
```

And without `x-user` there is nobody to check:

```sh
curl localhost:3002/api/workspaces/acme/boards
# {"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

## What to remember

- **Who** is the actor: `currentActor()`, never a user id passed by hand. Extend it
  with `declare module 'newt/core'` for who someone is and how they came, never for
  what they may do.
- **May they** is asked every time, of the module that knows (`member.enter`), and a
  stranger gets a 404, not a 403.
- **Where** is a scope (`defineScope`), entered once by a group's middleware. A
  repository with `scope` sees only the current workspace's rows, so no query can
  forget the filter; looking across workspaces is `findInEveryScope`, behind a name
  that says so. Every repository states its scope (`RepositoryScope` or `'none'`): it
  does not compile otherwise.
- What a context needs from another is a **port** in its own words, in the module's
  `.deps.ts`, handed in when the context opens. A test hands it a fake.

Next: [From files to SQLite](./05-sqlite).
