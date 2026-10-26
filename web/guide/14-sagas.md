# Sagas: a workspace comes and goes

Ana signs up and creates a workspace, acme. auth keeps workspaces (it calls them
tenants), and tells `tenant.created`. A moment later, acme should have a board to
start from in boards: *Welcome*, with *To do*, *Doing* and *Done*, and a first card
that tells her what to do. When acme is deleted, auth tells `tenant.deleted`, and
everything acme had in boards should go: its cards, its columns, its boards, its
activity.

Neither is one save. The welcome board is a board, three columns and a card: four
saves, in three modules. The deletion is three modules' rows and the log's. Any of
those saves can fail, or the server can stop between two of them. No transaction can
hold all of it: each module saves in its own.

A piece of work made of steps, each in its own transaction, is a **saga**. This
chapter writes boards' two: preparing a workspace, and purging one. They work because
of two things together: a worker runs the work again until it completes, and each step
finds what an earlier run did, so running it again **converges** on the same end.

## A module of its own: workspace

Neither saga belongs to the board, column or card module: each one puts all three to
work. So boards gets a module for what a workspace is in boards, `workspace`. It keeps
no table of its own. It reacts to auth's events about workspaces, writes into the
other modules from a worker, and, while it is at it, reads them all at once for a
board's screen.

### Its deps: auth's events about workspaces

As in [chapter 13](./13-another-context), what the module needs of auth is a port in
its own deps, in boards' words: two `EventSource`s, with only the workspace's id in
their payload. Create `modules/workspace/workspace.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.deps.ts
import type { EventSource } from 'newt/core'
import type { Board_Module } from '../board/board.module'
import type { Card_Module } from '../card/card.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

/**
 * auth's events about workspaces (its tenants) that boards reacts to, as a port: what
 * boards needs of them, in its own words. auth's emitters fit it; a test hands its own.
 */
export type TenantEvents = {
  created: EventSource<{ id: string }>
  deleted: EventSource<{ id: string }>
}

export interface Workspace_Deps {
  board: Board_Module
  column: Column_Module
  card: Card_Module
  member: Member_Module
  tenants: TenantEvents
}
```

It knows the three modules it writes into, and `member`, to ask whether a workspace
is still there (below).

### Its schema: the welcome board, and a board's screen

Create `modules/workspace/workspace.schema.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.schema.ts
import type { BoardDTO } from '../board/board.schema'
import type { CardDTO } from '../card/card.schema'
import type { ColumnDTO } from '../column/column.schema'

/** A board as its screen shows it: the board, its columns from left to right, and their cards from the top. */
export type BoardViewDTO = {
  board: BoardDTO
  columns: ColumnDTO[]
  cards: CardDTO[]
}

/** The board every new workspace starts with. */
export const WELCOME_BOARD = {
  name: 'Welcome',
  description: 'A first board to find your way around: move the card, add your own.',
  columns: ['To do', 'Doing', 'Done'],
  card: {
    title: 'Welcome to Cooper',
    description: 'Drag this card to Doing, then to Done. Add columns and cards of your own, and assign them to the people of your workspace.',
  },
} as const
```

`WELCOME_BOARD` is what every new workspace starts with, in one place. `BoardViewDTO`
is a board as its screen shows it, so that a client draws a board in one request
instead of three.

## Preparing a workspace

Create `modules/workspace/workspace.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { Workspace_Deps } from './workspace.deps'
import { registerWorkspaceRoutes } from './workspace.routes'
import { WELCOME_BOARD, type BoardViewDTO } from './workspace.schema'
import { registerWorkspaceWorkers } from './workspace.workers'

/**
 * A workspace as `boards` has it: what its boards, columns and cards are together.
 * It keeps nothing of its own: it puts the other modules to work, from a worker when
 * it writes in them, and reads them all at once for a board's screen.
 */
export class Workspace_Module extends Module {

  static initialize(base: BoardsBase, deps: Workspace_Deps): Workspace_Module {
    const module = new Workspace_Module(base, deps)
    registerWorkspaceRoutes(base, module, deps)
    registerWorkspaceWorkers(module, deps)
    return module
  }

  private constructor(base: BoardsBase, private readonly deps: Workspace_Deps) {
    super('workspace', base.invocations)
  }

  /** A board, its columns and its cards, in the current workspace: one screen. */
  @UseCase()
  async boardView(boardId: string): Promise<BoardViewDTO> {
    const board = await this.deps.board.get(boardId)
    const [columns, cards] = await Promise.all([this.deps.column.list(boardId), this.deps.card.listInBoard(boardId)])
    return { board, columns, cards }
  }

  /**
   * A new workspace gets its welcome board: "Welcome", with To do, Doing and Done, and
   * a first card. A worker calls it once auth created the workspace (eventual
   * consistency: for a moment, the workspace has no board), and it writes in three
   * modules, which only a worker may: if it fails halfway, its job runs it again.
   * Each step looks for what an earlier run did first, so a second run only finishes
   * what the first left, and adds nothing to a finished one; two runs at once add
   * each column and the card once, since their saves look again.
   *
   * A workspace auth deleted meanwhile gets nothing: its job may run late, after the
   * workspace's purge. One deleted while it runs has what it wrote purged again.
   */
  @UseCase()
  async prepare(workspaceId: string): Promise<void> {
    if (!await this.deps.member.exists(workspaceId)) return
    await runInWorkspace(workspaceId, async () => {
      const board = await this.deps.board.findByName(WELCOME_BOARD.name)
        ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
      const [todo] = await this.deps.column.addMissing(board.id, [...WELCOME_BOARD.columns])
      await this.deps.card.createFirst(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
    })
    if (!await this.deps.member.exists(workspaceId)) await this.purge(workspaceId)
  }

  /**
   * auth deleted a workspace: its cards, columns and boards go, in that order. boards'
   * step of that deletion: it cannot be undone, nor needs to be; a worker
   * runs it until it completes, and each part removes what is left, so running it
   * again after a failure halfway converges on a workspace with nothing.
   */
  @UseCase()
  async purge(workspaceId: string): Promise<void> {
    await this.deps.card.purgeWorkspace(workspaceId)
    await this.deps.column.purgeWorkspace(workspaceId)
    await this.deps.board.purgeWorkspace(workspaceId)
  }
}
```

`boardView` reads three modules, and reads are always fine from anywhere: one call
each. It runs in the current workspace, like any route's use case.

`prepare` is the first saga. Read its body as four steps:

1. The board: the one called *Welcome* if there is one already, or a new one.
2. The columns: the ones of the three names the board does not have yet. `addMissing`
   answers the board's columns of those names, in their order, so the first is *To
   do*, whatever was there before.
3. The card: the board's first one, unless it has one.
4. Before and after, whether the workspace is still there.

The worker that calls it runs in no workspace, so the steps run inside
`runInWorkspace(workspaceId, …)`: the event named the workspace.

### Each step finds what an earlier run did

Picture `prepare` failing after the board and one column were saved. Its job runs
again, from the top. If every step only created, the second run would add a second
*Welcome* board. Instead each step asks first:

- `board.findByName` finds the *Welcome* board the first run saved, whatever its
  case (board names are unique per workspace, ignoring case, since [chapter
  6](./06-rules-over-rows)). Only if there is none does `board.create` make it.
- `column.addMissing` adds only the names the board does not have, whatever their
  case: a *TO DO* left by the first run is *To do*.
- `card.createFirst` creates the card only if the board has none.

So the second run finishes what the first one left, and a run over a finished board
adds nothing. That is what "safe to run again" means for a step that creates:
**it looks for its result before making it.**

The two new use cases go in their modules. In `column.module.ts`, add `addMissing`
after `add`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /**
   * Adds at the end of the board the columns of these names it does not have yet,
   * whatever the case (`to do` is `To do`, as boards' names), and answers the board's
   * columns of these names, in their order: what a worker preparing a board calls, as
   * many times as it takes. Runs at once add each name once: the save checks it again.
   */
  @UseCase()
  async addMissing(boardId: string, input: string[]): Promise<ColumnDTO[]> {
    await this.deps.board.get(boardId)
    const names = input.map(name => ColumnAddSchema.parse({ name }).name)
    const columns = await this.repo.ofBoard(boardId)
    const added: Column[] = []
    for (const name of names) {
      if ([...columns, ...added].some(column => column.isNamed(name))) continue
      added.push(Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: columns.length + added.length }))
    }
    if (columns.length + added.length > MAX_COLUMNS) throw new TooManyColumns(boardId)
    if (added.length > 0) await this.repo.persistMissing(added, boardId)
    const all = [...columns, ...added]
    return names.map(name => all.find(column => column.isNamed(name))!.toDTO())
  }
```

- It parses each name once, as `add` does (trimmed, checked), before comparing.
- It compares names with the column's own `isNamed`, below: whatever the case, as
  boards' names compare since [chapter 6](./06-rules-over-rows). Without it, a board
  whose first run left *TO DO* would get a second *To do*.
- Each name is looked for among the board's columns **and** the ones added so far, so
  a list that names a column twice adds it once.
- It answers, for each name asked, the board's column of that name, in the order
  asked: the caller knows which is which without searching by name again. `prepare`
  takes the first, `const [todo] =`.

`isNamed` goes in `column.ts`, after the `position` getter, with a function `fold` at
the end of the file:

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
  /** Whether it has this name, whatever the case, as boards' names: only A to Z folded, as `ieq` compares. */
  isNamed(name: string): boolean {
    return fold(this.data.name) === fold(name)
  }
// …
function fold(name: string): string {
  return name.replace(/[A-Z]/g, letter => letter.toLowerCase())
}
```

`fold` lowers A to Z and leaves every other letter as it is: exactly what `ieq`
compares in the database (chapter [6](./06-rules-over-rows) told why the two must fold
the same). A name compared one way in memory and another in the save would let the
save find a duplicate the use case did not see, or miss one.

In `card.module.ts`, add `createFirst` after `create`. Its author is `BOARDS`, from
chapter 13: nobody created the welcome card.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * A board's first card, unless it has one already (null then): what a worker
   * preparing a board calls, as many times as it takes. Runs at once create it once:
   * the save counts the board's cards again.
   */
  @UseCase()
  async createFirst(boardId: string, input: CardCreateDTO): Promise<CardDTO | null> {
    if (await this.repo.count({ boardId }) > 0) return null
    const card = await this.newCard(boardId, input, BOARDS)
    await this.repo.persistNew(card, { first: true })
    return card.toDTO()
  }
```

### Two runs at once

Looking first is enough for a run that comes after another. It is not enough for two
runs at the same time: both look, both find nothing, both create. That happens: auth
may tell the event twice, or a job may be claimed again while its first run is still
going. Each step's save checks again, inside its transaction, as you learned in
[chapter 8](./08-two-people-one-card):

- The board: the table's unique index on (workspace, name) refuses the second
  *Welcome*. The save throws `DuplicateValue`.
- The columns: `persistMissing`, below, counts each name after writing, whatever its
  case.
- The card: `persistNew` counts the board's cards after writing.

The last two call `this.conflict()` when they find another run got there first. A
`DuplicateValue` is a `ConcurrencyConflict` too. And on a conflict, the use case runs
again: **the first use case of the chain**, here `prepare`, from the top, with all it
calls. The second time, `findByName` finds the board, `addMissing` finds the columns,
`createFirst` finds the card. Three runs at once from nothing leave one board, three
columns and one card, and all three jobs finish at their first attempt.

Add `persistMissing` to `column.repository.ts`, after `persistAdded`. It is
`persistAdded` for several columns, with one more check:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
  /**
   * Saves new columns at the end of their board, as `persistAdded` does, where none
   * of the board's other columns has their names, whatever the case: checked again after writing them,
   * guarding the board's columns. A save that finds one already there (another run
   * of the same work added it meanwhile) is a conflict, and the use case runs again,
   * finding it.
   */
  async persistMissing(columns: Column[], boardId: string): Promise<void> {
    await this.save(columns, each => this.write(each), {
      guard: [`columns:${boardId}`],
      before: async () => {
        const count = await this.count({ boardId })
        columns.forEach((column, index) => column.place(count + index))
      },
      after: async () => {
        if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
        for (const column of columns) {
          if (await this.count({ boardId, name: { ieq: column.name } }) > 1) this.conflict()
        }
      },
    })
  }
```

It counts with `{ ieq: column.name }`: the same comparison as `isNamed`, now in the
database, so a *TO DO* and a *To do* saved by two runs at once are one name twice, and
a conflict.

And give `persistNew` in `card.repository.ts` an option, `first`, and its check:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  async persistNew(card: Card, options: { first?: boolean } = {}): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`boardCards:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
      after: async () => {
        const count = await this.count({ boardId })
        if (count > MAX_CARDS) throw new TooManyCards(boardId)
        // Its board's first, and another one got in first: the use case runs again, and finds it.
        if (options.first && count > 1) this.conflict()
      },
    })
  }
```

`create` still calls `persistNew(card)`, with no options: only the welcome card
insists on being the first.

### A job that runs late

A job may run long after its event: a backlog, a restart, retries with a backoff. By
then auth may have deleted the workspace, and boards may have purged it already. A
`prepare` that ran then would give a deleted workspace a welcome board, and nothing
would ever remove it.

So `prepare` asks first whether the workspace is still there, and writes nothing if it
is not. And it asks again at the end: if the workspace went while it ran, the purge
may have run before its writes, so it purges again itself. Whichever order the two
jobs run in, a deleted workspace ends with nothing.

boards asks auth through the `Workspaces` port from [chapter
4](./04-who-and-where), which gets one more question. In `member.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
export type Workspaces = {
  /** Whether someone belongs to a workspace now, deleted it has nobody: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
  /** Whether a workspace is still there: deleted, a worker has nothing to write in it. */
  exists(workspaceId: string): Promise<boolean>
}
```

The member module asks it for the others, in `member.module.ts` after `isMember`:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
  /** Whether a workspace is still there: what a worker that writes in one asks first. */
  @UseCase()
  async exists(workspaceId: string): Promise<boolean> {
    return this.deps.workspaces.exists(workspaceId)
  }
```

### The write rule, checked

`prepare` writes into three modules that are not its own. [Chapter
13](./13-another-context) said why that may only happen from a worker: each module
saves in its own transaction, and if a request did this and failed after the board,
the request would answer an error and nothing would ever finish the work. From a
worker, the job runs again until it completes.

newt checks it as the use cases run. A use case of `board` that saves, called under
a use case of `workspace` outside a worker, throws:

```text
[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo
```

and the save does not happen. The second way out the message offers, `writesTo`, is
for the rare justified exception, said where it is seen (`card.removeColumn`,
[chapter 8](./08-two-people-one-card)). `prepare` needs none: a worker calls it.

Sometimes you want to do by hand what a worker would: in a test, or in a script that
prepares workspaces made before this feature existed. `base.jobs.runAsWorker(fn)`
runs `fn` as a job runs: in a worker, so its use cases may write to any module, and
with no actor nor scope but the ones it sets itself.

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
    await t.boards.base.jobs.runAsWorker(() => t.modules.workspace.prepare('acme'))
```

What you run that way still has to be safe to run again: it gets no job, and nothing
runs it a second time if it fails.

## Purging a workspace

`purge`, at the end of `workspace.module.ts`, is the second saga. auth deleted the
workspace; it is not coming back, so nothing here ever needs undoing. Every step only
has to complete. Cards go first, then columns, then boards: should a run stop
halfway, what is left is boards without cards or columns, never a card in a column
that is gone.

Each module removes its own rows, with a use case of its own. They all look alike.
In `card.module.ts`, after `unassignMember`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** A workspace was deleted in auth: its cards go. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

In `column.module.ts`, after `remove`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /** A workspace was deleted in auth: its columns go. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

In `board.module.ts`, after `archive`:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  /**
   * A workspace was deleted in auth: its boards go, archived ones too. A step of that
   * deletion: a worker calls it, as many times as it takes, and the second
   * time finds nothing to remove.
   */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

### Removing rows for good: `purge`

Until now rows went one entity at a time: a card is loaded, deleted, saved, and tells
`card.deleted`; a board is archived, which stamps `deletedAt` and keeps its row.
Neither fits here. Nobody needs a `card.deleted` for each card of a workspace that no
longer exists, and an archived board of it must go too: these rows will never tell
anything to anyone.

A `TableRepository` removes rows for good with **`purge(criteria)`**. It deletes every
row that matches, in every scope (the workspace is named, not the current one: nobody
is in it any more), the ones deleted softly too (archived boards). It loads no entity
and tells no event. It writes as `saveRows` does: one transaction, under the write
rule.

In `board.repository.ts`, after `recentInEveryScope`:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
  /**
   * Removes every board of a workspace, archived ones too, for good: rows that will
   * tell nothing, so `purge` removes them. The workspace is named, not the current
   * one: auth deleted it, and nobody is in it.
   */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.purge({ workspaceId })
  }
```

In `column.repository.ts`, at the end:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
  /** Removes every column of a workspace for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.purge({ workspaceId })
  }
```

The cards have a second table, each board's counter of numbers ([chapter
7](./07-cards-and-a-counter)). Rows that are no entity's are written with
**`saveRows(write)`**: one transaction around whatever `write` does. The cards and
their counters go together. In `card.repository.ts`, after `persistOrder`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /** Removes every card of a workspace, and its boards' counters, for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.saveRows(async () => {
      await this.purge({ workspaceId })
      await this.counters.deleteMany({ workspaceId })
    })
  }
```

Run any of them a second time and there is nothing left to delete. Nothing fails.

### The activity goes too

Each card's activity is the activity module's, and it reacts on its own to the same
event. Its port only needs `deleted`, so it says only that. Replace `activity.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.deps.ts
import type { EventSource } from 'newt/core'
import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

/** auth's event about workspaces the activity reacts to, as a port: auth's emitter fits it. */
export type WorkspaceDeletions = {
  deleted: EventSource<{ id: string }>
}

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
  /** That who reads a card's activity belongs to its workspace (its routes). */
  member: Member_Module
  /** auth deleting a workspace: its log goes with it. */
  tenants: WorkspaceDeletions
}
```

`TenantEvents` has `deleted` too, so the same object fits both ports. Add the use case
to `activity.module.ts`, after `recordDeleted`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
  /** A workspace was deleted in auth: its log goes. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

its repository's method, at the end of `activity.repository.ts`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.repository.ts
  /** Forgets every entry of a workspace: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.purge({ workspaceId })
  }
```

and the subscription, in `activity.workers.ts`, after the six card events:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.workers.ts
  // auth deleted a workspace: its log goes, like its boards (a job of auth's outbox).
  deps.tenants.deleted.subscribe(tenant => activity.purgeWorkspace(tenant.id), {
    strategy: 'handler',
    queue: 'activity.purgeWorkspace.on.tenant.deleted',
  })
```

## The workers

The workspace module's two reactions. Create `modules/workspace/workspace.workers.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

/**
 * boards follows auth's workspaces, a moment later: a new one gets its welcome board,
 * and a deleted one loses everything it had here. Each reaction is a job of auth's
 * worker, saved with the change that tells it, and run until it completes.
 */
export function registerWorkspaceWorkers(workspace: Workspace_Module, deps: Workspace_Deps): void {
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
  deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.purge.on.tenant.deleted',
    // The workspace is gone in auth already: a purge that keeps failing must not die soon.
    attempts: 10,
  })
}
```

Both are `handler`s: jobs written in auth's transaction, in auth's outbox, run by
auth's worker (chapter 13). The purge takes **`attempts: 10`** instead of the default
five. A job that runs out of attempts is dead ([chapter 12](./12-failures)), and a
dead purge is a saga stuck halfway: a workspace auth deleted whose boards are still in
boards, with nothing left to finish it. Ten attempts, with a backoff that grows
between them, give a passing failure (the database restarting, a deploy) time to go
away. If it still dies, the outbox lists it: someone looks at it, fixes the cause, and
retries it.

## Converging

Put the pieces together and picture `purge` failing after the cards, before the
columns. Its job runs again:

- `card.purgeWorkspace` deletes the workspace's cards. There are none. Fine.
- `column.purgeWorkspace` deletes its columns.
- `board.purgeWorkspace` deletes its boards.

The workspace ends with nothing, as if nothing had failed. That is converging:
wherever the work stops, running it again leads to the same end. It needs both
halves:

- **Each step is safe to run again.** It writes a result ("this workspace has no
  cards"; "this board has these columns"), or finds what an earlier run did.
- **The work is run again until it is done.** Each saga is a job saved with the
  event that starts it, and retried when it fails.

Take either away and the work can stay halfway for good. A step run only from a
request is lost if it fails; a step that is not safe to repeat breaks on its retry.

Both of boards' sagas only go forward. A flow that something else can stop halfway
(an order cancelled after its stock was reserved) needs, for each step done, a
**compensation**: another step, from a worker, on the event that stops the flow, that
undoes it, and that is also safe to run again, even if the step it undoes never ran.
cooper has none.

## A board as one screen

The module's route serves `boardView`. Create `modules/workspace/workspace.routes.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

export function registerWorkspaceRoutes(base: BoardsBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/view', async request => Response.json(await workspaces.boardView(request.params.boardId)))
}
```

`GET /api/workspaces/:workspaceId/boards/:boardId/view` answers the board, its columns
and its cards together. A board of another workspace is a 404, as any board is.

## FakeAuth creates and deletes workspaces

The fake auth tells the two new events, from its store, as it tells
`access.revoked`. It answers `exists` from the workspaces it has members in, gives
`tenants` for the new port, and shows its jobs, so that a test can see each finished.
Replace `testing/fake-auth.ts`:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
import { SqliteStore } from 'newt/adapter-sqlite'
import { Email } from 'newt/contract'
import { eventsOf, now, type DomainEvent } from 'newt/core'
import { Base } from 'newt/runtime'
import type { AccessEvents } from '../modules/card/card.deps'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'
import type { TenantEvents } from '../modules/workspace/workspace.deps'

class Tenant_Created implements DomainEvent<{ id: string }> {
  static readonly eventName = 'tenant.created'
  readonly name = Tenant_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}

class Tenant_Deleted implements DomainEvent<{ id: string }> {
  static readonly eventName = 'tenant.deleted'
  readonly name = Tenant_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}

type Access = { userId: string, productId: string, tenantId: string | null }

class Access_Revoked implements DomainEvent<Access> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: Access) {}
}

/**
 * auth, as `boards`' tests need it: who belongs to each workspace, kept in memory, and
 * auth's events about workspaces and access, told as auth tells them. Each event is
 * published in a transaction of its own store, so boards' handlers are jobs of its
 * worker, as they are of auth's, and run only on `idle`.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** The port of who belongs to each workspace. */
  readonly workspaces: Workspaces = {
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
    member: async (workspaceId, userId) => this.members.get(workspaceId)?.get(userId) ?? null,
    exists: async workspaceId => this.members.has(workspaceId),
  }

  readonly tenants: TenantEvents
  readonly access: AccessEvents

  private constructor(private readonly base: Base) {
    this.tenants = eventsOf(base.bus, { created: Tenant_Created, deleted: Tenant_Deleted })
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

  /** A workspace is created, with its creator in it: `tenant.created`. */
  async createWorkspace(workspaceId: string, creatorId: string): Promise<void> {
    this.join(workspaceId, creatorId)
    await this.tell(new Tenant_Created({ id: workspaceId }))
  }

  /**
   * `tenant.created` told again, and nobody joins: as a job of it run late, after its
   * workspace is gone.
   */
  async tellCreatedAgain(workspaceId: string): Promise<void> {
    await this.tell(new Tenant_Created({ id: workspaceId }))
  }

  /** A workspace is deleted, and nobody belongs to it any more: `tenant.deleted`. */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.members.delete(workspaceId)
    await this.tell(new Tenant_Deleted({ id: workspaceId }))
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

  /** The jobs of its events, as they stand: to see one that failed. */
  jobs() {
    return this.base.store.outbox.list()
  }

  close(): Promise<void> {
    return this.base.close()
  }

  private async tell(event: DomainEvent): Promise<void> {
    await this.base.store.transaction(() => this.base.bus.publish(event))
  }
}
```

- `createWorkspace` puts its creator in it and tells `tenant.created`.
- `deleteWorkspace` removes everyone, so `exists` says no, and tells
  `tenant.deleted`.
- `tellCreatedAgain` tells `tenant.created` without anyone joining: a job of the event
  running late, after its workspace was deleted.
- `jobs()` lists auth's outbox as it stands, with each job's status.

## Wiring it

`Boards_ModuleDeps` gets `tenants`, and boards initializes the workspace module, after
the modules it uses, and hands the activity module `tenants` too. Replace
`initialize-modules.ts`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'
import type { TenantEvents } from './modules/workspace/workspace.deps'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about workspaces and
 * access), and a mailer. Whoever opens the context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  mailer: Mailer
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants })
  const activity = Activity_Module.initialize(base, { card, member, tenants: deps.tenants }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

The test helper hands FakeAuth's `tenants`, in `testing/open-test-boards.ts`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
```

and so does the dev server, in `index.ts`:

```ts
// cooper/backend/index.ts
const boards = await Boards_Context.open(config.boards, {
  workspaces: auth.workspaces,
  tenants: auth.tenants,
  access: auth.access,
```

The dev server's fake auth only lets people join, as before: no workspace is created
there, so it gets no welcome board. You see that from the tests.

## Tests

Create `modules/workspace/workspace.test.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { WELCOME_BOARD } from './workspace.schema'

describe('workspace', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  /** The welcome board of acme, as its screen shows it: each column with its cards' titles. */
  const welcome = async () => {
    const boards = await inAcme(() => t.modules.board.list({ size: 10 }))
    const view = await inAcme(() => t.modules.workspace.boardView(boards.items[0]!.id))
    return {
      boards: boards.items.map(board => String(board.name)),
      columns: view.columns.map(column => [column.name, view.cards.filter(card => card.columnId === column.id).map(card => card.title)]),
    }
  }

  test('gives a new workspace its welcome board, a moment after auth creates it', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)

    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['Welcome'],
      columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
  })

  test('prepares a workspace once, however many times its work runs, and finishes one left halfway', async () => {
    t.auth.join('acme', 'ana')
    // A first run that stopped halfway: the board and one column, their names in another case.
    const board = await inAcme(() => t.modules.board.create({ name: 'welcome' }))
    await inAcme(() => t.modules.column.add(board.id, { name: 'TO DO' }))

    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()
    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['welcome'],
      columns: [['TO DO', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
  })

  test('prepares nothing in a workspace auth deleted before its work ran', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.auth.deleteWorkspace('acme')
    await t.settled()

    // The work of `tenant.created`, run again late: after the workspace was purged.
    await t.auth.tellCreatedAgain('acme')
    await t.settled()

    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
  })

  test('gives the welcome board its columns and its card once, however many runs go at once', async () => {
    t.auth.join('acme', 'ana')
    // A first run that stopped halfway: the board, and none of its columns.
    await inAcme(() => t.modules.board.create({ name: 'Welcome' }))

    await Promise.all([t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana')])
    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['Welcome'],
      columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
    expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done'])
  })

  test('gives a workspace one welcome board, however many runs start at once from nothing', async () => {
    await Promise.all([t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana')])
    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['Welcome'],
      columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
    expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done'])
  })

  test('refuses to prepare a workspace outside a worker, since it writes in other modules, and prepares it in one', async () => {
    t.auth.join('acme', 'ana')

    await expect(inAcme(() => t.modules.workspace.prepare('acme'))).rejects.toThrow('[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo')
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)

    // What a script does by hand, as the worker of `tenant.created` would.
    await t.boards.base.jobs.runAsWorker(() => t.modules.workspace.prepare('acme'))
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
  })

  test('removes all a workspace has once auth deletes it, and nothing of any other', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.auth.createWorkspace('globex', 'bea')
    await t.settled()

    await t.auth.deleteWorkspace('acme')
    await t.settled()

    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)

    // Its work run again, as after a failure halfway: nothing left to remove, nothing fails.
    await t.auth.deleteWorkspace('acme')
    await t.settled()
    // Each deletion is heard twice: the workspace's purge, and its activity's.
    expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
  })

  test('leaves the cards of someone who left a workspace without an assignee', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    t.auth.join('acme', 'bea')
    await t.settled()
    const { columns, cards } = await inAcme(async () => t.modules.workspace.boardView((await t.modules.board.list({ size: 1 })).items[0]!.id))
    const mine = await inAcme(() => t.modules.card.create(cards[0]!.boardId, { columnId: columns[1]!.id, title: 'Mine', assigneeId: 'ana' }))
    await inAcme(() => t.modules.card.assign(cards[0]!.id, { assigneeId: 'bea' }))

    await t.auth.revoke('acme', 'bea')
    await t.settled()

    expect((await inAcme(() => t.modules.card.get(cards[0]!.id))).assigneeId).toBeNull()
    expect((await inAcme(() => t.modules.card.get(mine.id))).assigneeId).toBe('ana')
  })

  test('takes a card left in a removed column to the first one, a moment later', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()
    const { board, columns, cards } = await inAcme(async () => t.modules.workspace.boardView((await t.modules.board.list({ size: 1 })).items[0]!.id))
    const [todo, doing] = [columns[0]!, columns[1]!]
    await inAcme(() => t.modules.card.create(board.id, { columnId: doing.id, title: 'Already there' }))

    // As if a card were moved into it while it was being removed: the column goes with a card in it.
    await inAcme(() => t.modules.column.remove(todo.id))
    await t.settled()

    const view = await inAcme(() => t.modules.workspace.boardView(board.id))
    expect(view.columns.map(column => column.name)).toEqual(['Doing', 'Done'])
    expect(view.cards.map(card => [card.columnId, card.position, card.title])).toEqual([
      [doing.id, 0, 'Already there'],
      [doing.id, 1, cards[0]!.title],
    ])
  })
})
```

What each test shows:

- **The welcome board, a moment later.** Right after auth creates the workspace,
  boards has no board: the work has not run yet. That is eventual consistency, and
  the test says it on purpose. After `settled()`, the board is there.
- **Once, and finishing one left halfway.** The test plays a first run that stopped
  after the board (named `welcome`, in lower case) and one column (*TO DO*, in upper
  case). Two more runs finish it: the board and the column are found whatever their
  case, *Doing* and *Done* are added, and the card once, in *TO DO*.
- **Nothing in a workspace deleted before its work ran.** `tellCreatedAgain` makes
  the job of `tenant.created` run after the purge. `prepare` finds no workspace and
  writes nothing. `listOf` reads a named workspace's boards, from outside any.
- **Runs at once.** Three runs over a board with no columns, and three runs from
  nothing: one board, three columns, one card, and every job `done`. These are the
  conflicts at work: the runs that lost ran `prepare` again and found everything.
- **The write rule, and `runAsWorker`.** `prepare` from a test, as a person in acme,
  is refused at its first write, and nothing is saved. Run as a worker, it prepares
  the workspace.
- **A purge that touches no other workspace**, run a second time, as after a
  failure: nothing left, nothing fails. The six jobs are the two `prepare`s, and
  for each of the two deletions the workspace's purge and the activity's.
- **Someone who left**, and **a card left in a removed column**: chapter 13's two
  reactions, now on a welcome board. The second replaces the test you added to
  `card.test.ts` in chapter 13: delete that one, `takes a card left in a removed
  column to the first one of its board, a moment later`, from `card.test.ts`.

In `column.test.ts`, after the test that keeps a board's last column, `addMissing` on
its own:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
  test('adds the columns a board is missing, by name whatever the case, and answers them in their order', async () => {
    const todo = await add('TO DO')

    const columns = await inAcme(() => t.modules.column.addMissing(boardId, ['Done', ' to do ', 'DONE', 'Doing']))

    expect(columns.map(column => column.name)).toEqual(['Done', 'TO DO', 'Done', 'Doing'])
    expect(columns[1]!.id).toBe(todo.id)
    expect(await names()).toEqual(['0:TO DO', '1:Done', '2:Doing'])
  })
```

The board has *TO DO*. Asked for `'Done'`, `' to do '`, `'DONE'` and `'Doing'`,
`addMissing` adds *Done* and *Doing* once each, finds *TO DO* for `' to do '` (trimmed,
then compared whatever the case), and answers four columns in the order asked: *Done*,
the board's *TO DO* (the same id), *Done* again and *Doing*.

In `boards.context.test.ts`, the test that keeps a board, its columns and its cards
now reads them through `/view`. Rename it and replace its two reads:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board, its columns and its cards, and shows them as one screen', async () => {
// …
    const view = await call<{ board: { name: string }, columns: { name: string }[], cards: { title: string }[] }>('GET', `/acme/boards/${id}/view`)
    expect(view.body.board.name).toBe('Plans')
    expect(view.body.columns.map(column => column.name)).toEqual(['To do', 'Done'])
    expect(view.body.cards.map(each => each.title)).toEqual(['Plan'])
```

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

The workspace's tests on their own:

```sh
bun test cooper/backend/contexts/boards/modules/workspace
```

```text
 9 pass
 0 fail
 19 expect() calls
Ran 9 tests across 1 file.
```

Then a board's screen by hand. Start the backend (`bun cooper/backend/index.ts`), make
a board with two columns and a card, and ask for its view:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Screen $RANDOM\"}" | jq -r .id)
TODO=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"Done"}' > /dev/null
curl -s -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -d "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" > /dev/null
curl -s $API/boards/$BOARD/view -H 'x-user: ana' | jq '{board: .board.name, columns: [.columns[].name], cards: [.cards[] | {number, title, position}]}'
```

```json
{
  "board": "Screen 15634",
  "columns": [
    "To do",
    "Done"
  ],
  "cards": [
    {
      "number": 1,
      "title": "Plan",
      "position": 0
    }
  ]
}
```

The same board from globex, where bea is:

```sh
curl -s http://localhost:3002/api/workspaces/globex/boards/$BOARD/view -H 'x-user: bea'
```

```text
{"error":"There is no board 01a17956-fcec-7399-89dd-d9ce77f6fe34","code":"board.not_found"}
```

with status 404 (your id differs).

## What to remember

- Work over several modules is a saga: steps, each its own save. It runs from a
  worker, which runs it again until it completes; newt refuses it outside one (the
  write rule), and `base.jobs.runAsWorker` runs it as one by hand.
- Each step finds what an earlier run did before doing it, and its save checks again,
  so two runs at once end in a conflict and the chain's first use case runs again. A
  run again converges on the same end.
- A job may run late: ask whether what it works on is still there, before and after.
- Rows that will never tell anything go for good with `purge(criteria)` (every scope,
  soft-deleted ones too, no events), or `saveRows` around several tables.
- A saga that only goes forward needs no compensation; give its job more `attempts`,
  because a dead one is work stuck halfway.

Next: [Queries a table cannot say: Kysely](./15-kysely).
