# Listening to another context

Bea leaves acme. Whoever runs acme takes her access away, and that happens in auth,
which keeps who belongs to each workspace. boards keeps the cards, and some of acme's
cards still say they are Bea's. Nobody will work on them now. They should go back to
having no assignee.

auth and boards are two contexts, each with its own database (auth arrives for real
in chapter 17; until then a fake one stands in). auth must not reach into boards and
unassign the cards: it would have to know boards, and it would write into rows that
are not its own. auth only **tells** what happened, `access.revoked`, and boards
**listens** and does its own part.

The same shape fixes something closer to home. [Chapter 8](./08-two-people-one-card)
left a gap in `removeColumn`: a card moved into a column between the count and the
removal ends up in a column that is gone. That is also something that happened
(`column.removed`, told by the column module) whose consequence belongs to someone
else (the cards).

This chapter adds both reactions to the card module. Each one is boards' own work,
done by nobody in particular, from a worker, and each is safe to run again.

## A card left in a removed column

Recall the gap. `card.removeColumn` counts the cards in the column, and if there are
none it has the column module remove it. Between the count and the removal, Carla
moves a card into that column. The count said zero, the column goes, and Carla's
card points at a column no list shows. Her card is lost from the board.

You cannot close this by counting better: the count and the removal are saves of two
modules, and the column module knows nothing of cards. So you let the gap happen and
clear it right after. Removing a column tells `column.removed` (since [chapter
10](./10-events)), with the column in its payload. The card module listens, and moves
any card still in that column to the board's first one.

### Nobody did it

Cards' events say who did what (`by`, `via`, since chapter 10). A use case that a
worker calls runs with no actor: `currentActor()` would throw. There is no person
behind it; boards does it on its own. Say so with an author of nobody. Add it to
`card.module.ts`, after the events' imports, along with the import of `ColumnDTO`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { runInWorkspace } from '../../workspace-scope'
import type { ColumnDTO } from '../column/column.schema'
// …
import { Card_Unassigned } from './events/card-unassigned'

/** Boards' own work, from a worker: no one did it. */
const BOARDS: CardAuthor = { by: null, via: null }
```

`CardAuthor` already allows it (`by: string | null`): the activity log records such
an entry with no actor.

### The use case

Add `leaveRemovedColumn` right after `removeColumn`, and finish `removeColumn`'s
comment with who takes care of what it leaves:

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

Step by step:

- A worker runs in no workspace. The removed column's DTO carries its
  `workspaceId`, so the use case enters it with `runInWorkspace` (as `notifyAssignee`
  did in [chapter 12](./12-failures)), and the repositories see that workspace's rows.
- It looks for cards still in the removed column. Almost always there are none, and
  it returns: the usual removal went through `removeColumn`, which checked.
- The first column is the board's first one now, after the removal: `column.list`
  no longer shows the removed one. If the board has no column left at all, there is
  nowhere to take the cards, and it leaves them.
- The cards go to the bottom of that column, in their order, with `moveTo` by
  `BOARDS`. Each tells `card.moved`, as any move does.
- `persistOrder` (from [chapter 8](./08-two-people-one-card)) saves them, guarding
  both columns and checking their order after writing. A card someone moved
  meanwhile is a conflict, and the use case runs again with what is there then.

Run it a second time and it finds no card in the removed column, and does nothing.
That matters, because a worker may run it more than once.

The column module's own comment on `remove` says the same, so that someone reading
it learns that a card can be left in the column, and what happens to it. Replace it
in `column.module.ts`:

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

The subscription comes below, with the other one, in `card.workers.ts`.

## auth's events, as a port

Now Bea. boards wants to hear that someone lost their access. That event is auth's,
and boards must not import auth's modules: the card module would then depend on
another context's code, and a test of boards would need auth whole.

So the card module says what it needs, in its own words, in its deps file. Not auth's
access module: only something it can **subscribe to**. That is newt's
**`EventSource<T>`**, from `newt/core`: the `subscribe` of an emitter, nothing more.
Any module's `events.<name>` fits it, and so does whatever a test hands.

Replace `card.deps.ts`:

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

- `RevokedAccess` is the payload boards expects: who, to which product, and in which
  tenant. auth gives access to more than workspaces: the backoffice is a product too,
  with no tenant (`null`). boards only cares about workspaces, but the port says what
  auth really tells, so that auth's emitter fits it as it is.
- It is a `type`, not an `interface`: an event's payload is JSON, and TypeScript only
  takes a type alias as JSON (the same rule as your own events' payloads in chapter 10).
- `AccessEvents` groups auth's events about access that boards hears. One for now.
- `Card_Deps` gets `access`, next to the modules it already had. The column's comment
  adds what the cards now ask it: where cards left in a removed column go.

The port is what boards is given, not what it reaches for. Whoever opens the context
hands it: a fake auth now, and auth's real `access.events` from [chapter
20](./20-wiring-contexts).

## Which events: `when`, with a type guard

Both reactions go in `card.workers.ts`. Replace it:

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

The first new subscription is the column's. It is a `handler`, like the email of
chapter 12: a job saved with the removal, in the same transaction, and run until it
completes. Its queue follows the name rule: `card.leaveRemovedColumn`, the module and
use case that react, `.on.column.removed`, the event.

The second one is auth's. auth tells every access it takes away, to any product, and
boards only wants the ones to a workspace of cooper. You met `when` in chapter 12,
where a new card's email is sent only when it has an assignee. Here it does a second
job.

- **It decides which events get a job at all.** `when` runs in the transaction of the
  save that tells the event, before any job is written. An event it does not take
  leaves no job: a staff member losing the backoffice writes nothing for boards.
  It only looks at the payload; whether the event matters is `when`'s, never the use
  case's business logic.
- **Written as a type guard, it narrows what the callback gets.** The payload says
  `tenantId: string | null`, and `unassignMember` takes a `string`. The guard
  `(access: RevokedAccess): access is RevokedAccess & { tenantId: string }` tells
  TypeScript that whatever passes has a tenant, so the callback can hand
  `access.tenantId` straight to the use case. A `when` that returned a plain boolean
  would filter the same events, but the callback would still see `string | null`, and
  the call would not compile. Type the parameter, as here, for the guard to take.

For now the product's name is written here as `'cooper'`. auth names it with a
constant, `WORKSPACES_PRODUCT`, which is not usable here until chapter 20; it replaces the
string then.

## Leaving the cards without an assignee

Add `unassignMember` to `card.module.ts`, after `notifyAssignee`:

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

It enters the workspace the event named, finds the cards assigned to that person
there, unassigns each by `BOARDS`, and saves them all in one save. Each card tells
`card.unassigned`, so the activity log records it, with no actor. The second run finds
no card of hers, saves nothing, and is done.

## The write rule

Look at who writes what. `access.revoked` is told by auth, in auth's save. The cards
are unassigned by the card module, in boards' save. auth never touches a card; boards
never touches an access. The column's case is the same inside boards: the column
module removes the column, and the card module moves the cards.

That is the rule [chapter 8](./08-two-people-one-card) named when `removeColumn`
needed an exception: **only a worker writes into another module**. When something
in one module has a consequence in another, the first one tells an event and the
second one reacts, from a worker. The job is saved with the change that tells the
event, so both are stored or neither is, and it runs again until it completes. A
direct call from auth into boards would be two saves with nothing to finish the
second if it failed; and auth would have to know boards.

Here neither reaction even crosses into another module: each is a use case of the card
module writing the card module's rows. [Chapter 14](./14-sagas) has one that writes
into three, and shows newt checking the rule as it runs.

## Whose worker runs it

A `handler`'s job is written in the transaction of the save that tells the event,
and in that save's store. `access.revoked` is told in auth's store, so the job of
`card.unassignMember.on.access.revoked` is in **auth's outbox**, run by auth's worker.
It calls boards' use case, which saves in boards' store. Unassigning tells
`card.unassigned`, whose activity job is in **boards' outbox**, run by boards'
worker.

```text
auth's store                              boards' store
┌───────────────────────────────┐
│ access revoked                │
│ job: card.unassignMember.on.  │ ──▶ card.unassignMember ──▶ ┌──────────────────────────┐
│      access.revoked           │     (auth's worker)          │ card: assigneeId = null  │
└───────────────────────────────┘                              │ job: activity.record...  │ ──▶ boards' worker
                                                               └──────────────────────────┘
```

So waiting for "the background work" now means waiting for auth's jobs first, then
boards'.

## A fake auth that tells

auth does not exist yet. `FakeAuth` (from [chapter 4](./04-who-and-where)) answers
who belongs to each workspace from memory. It now also tells `access.revoked`, the
way auth will: from a store of its own, so that boards' handlers become jobs of its
outbox and run only when its worker runs them. Replace
`testing/fake-auth.ts`:

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

- `Access_Revoked` is an event class like the ones you wrote in chapter 10: a static
  `eventName`, the `name`, when it occurred, and the payload.
- `FakeAuth.open` makes a `Base` named `auth` on a `SqliteStore` in memory: a bus
  and an outbox, with nothing else.
- `access` is `eventsOf(base.bus, { revoked: Access_Revoked })`, as each module of
  boards makes its `events`. It fits `AccessEvents`.
- `revoke` takes the person out of the workspace and tells `access.revoked`.
- `tell` publishes on the bus inside a transaction of its store. Your events are
  published by a repository's save; something that is not an entity's may publish on
  `base.bus` directly, with the same guarantees: its jobs are written in the
  transaction in progress. FakeAuth has no entity, so it opens one of its own.
- `idle` runs auth's jobs until none is left, and `close` closes its store. Nothing
  starts FakeAuth's worker: in a test, its jobs run when the test waits for them.

## Wiring it

`Boards_ModuleDeps`, what whoever opens boards hands its modules, gets `access`, and
the card module receives it. In `initialize-modules.ts`, import the port, add it to
the type and its comment, and pass it to `Card_Module.initialize`:

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

The test helper hands FakeAuth's events, waits for auth's jobs before boards' in
`settled`, and closes auth after boards. In `testing/open-test-boards.ts`:

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

The dev server hands them too, in `index.ts`:

```ts
// cooper/backend/index.ts
const boards = await Boards_Context.open(config.boards, {
  workspaces: auth.workspaces,
  access: auth.access,
  mailer: new ConsoleMailer(config.mail.from),
  log: line => console.log(line),
})
```

Nothing in the dev server revokes an access yet, so there is nothing to try there by
hand.

## Tests

In `activity.test.ts`, after the first test, a card of Bea's, and Bea leaving. The
last entry of its activity is the unassignment, by nobody:

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

It goes through the whole chain: FakeAuth tells, auth's worker runs
`unassignMember`, the card tells `card.unassigned`, boards' worker records it. One
`settled()` waits for all of it.

In `card.test.ts`, after the test of the email to nobody, the removed column. The test
calls `column.remove` directly, skipping `removeColumn`'s check, which is exactly what
the race does:

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

Card #2 was in *To do*. Once *To do* is gone, *Doing* is the board's first column,
and #2 lands at its bottom, under #1. (This test moves to the workspace's own tests in
the next chapter, on a welcome board.)

## Check it

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

The two new tests on their own:

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

## What to remember

- What a module needs of another context is a port in its own deps, in its own
  words. For events, an `EventSource<T>`: only `subscribe`. The other context's
  emitter fits it; a test hands its own.
- `when` picks which events get a job, in the transaction that tells them, so an
  event it does not take leaves nothing. Written as a type guard with a typed
  parameter, it narrows what the callback gets.
- Only a worker writes into another module. A consequence in someone else's data is an
  event told and a reaction from a worker, never a direct write.
- What boards does on its own is done by nobody: `{ by: null, via: null }`. A worker
  has no actor, and enters the workspace the event names with `runInWorkspace`.
- A reaction may run twice. Make the second run find nothing to do: no card left in
  the column, no card of hers left assigned.

Next: [Sagas: a workspace comes and goes](./14-sagas).
