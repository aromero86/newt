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
left a gap in `removeColumn`: a card moved into a column, or created in it, between
the count and the removal ends up in a column that is gone. That is also something
that happened (`column.removed`, told by the column module) whose consequence belongs
to someone else (the cards).

Both have a twist. A reaction runs a moment after the event, and in that moment the
other side may still be on its way: a card may be saved into a column whose removal
was already handled, or given to someone whose leaving was already handled. This
chapter closes that race too, in both directions, and the way it does is the idea to
take from it: **each side, once saved, looks at the other**.

## A card left in a removed column

Recall the gap. `card.removeColumn` counts the cards in the column, and if there are
none it has the column module remove it. Between the count and the removal, Carla
moves a card into that column. The count said zero, the column goes, and Carla's
card points at a column no list shows. Her card is lost from the board.

You cannot close this by counting better: the count and the removal are saves of two
modules, and the column module knows nothing of cards. So you let the gap happen and
clear it right after. Removing a column tells `column.removed` (since [chapter
10](./10-events)), with the column in its payload. The card module listens, and moves
any card still in that column to the board's first one. A board always has one: since
[chapter 8](./08-two-people-one-card), its last column is not removed.

### The race the other way

That covers a card that was in the column when it went. It does not cover the other
order. `card.move` checks the column it is given (`assertColumnOf` asks the column
module for the board's columns), then reads the cards and saves. Between its check and
its save, the column can be removed, and its worker can run:

```text
Carla moves #4 to Done                      ana removes Done
──────────────────────                      ────────────────
checks Done is a column of the board
                                            counts Done's cards: 0
                                            removes Done, tells column.removed
                                            worker: cards in Done? none
saves #4 in Done, tells card.moved
```

The column's worker ran and found nothing, because the card was not there yet. Then
the card arrived in a column nobody will look at again. Nothing in the card's save
sees the column go: the column is another module's row, and the move guards the cards
it reorders, not the column.

You cannot make the worker wait for a move that might come. What you can do is give
the card a look of its own. The card tells `card.moved` once saved; a worker on it
asks: is my column still there? If it is gone, the card goes to the first column, as
the column's worker would have done. A card created in a column has the same gap
(`newCard` checks the column too, before its save), so `card.created` gets the same
look.

Now there are two followers, and each one runs **after its own save** and **looks at
the other side's state**:

- The column's worker runs after the removal is saved, and looks at the cards.
- The card's worker runs after the card is saved, and looks at the column.

Whichever of the two runs last sees both saves, and moves the card. The one that runs
first may find nothing to do, and that is fine. In any order, the board ends the same:
no card in a removed column. One use case serves both, `leaveRemovedColumn`, as long as
it checks both things: there is a card in the column, and the column is gone.

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
   * A column may be gone: any card still in it goes to the bottom of the board's first
   * column. What a worker calls when a column is removed, and when a card is created
   * in one or moved to one: the card checked its column before its save, and the
   * column may have gone in between, its own worker finding no card yet. Each runs after
   * its own save and looks at the other's, so whichever runs last finds the card.
   * Safe to run again: a column still there, or with no card in it, is left as it is.
   */
  @UseCase()
  async leaveRemovedColumn(column: Pick<ColumnDTO, 'id' | 'boardId' | 'workspaceId'>): Promise<void> {
    await runInWorkspace(column.workspaceId, async () => {
      const left = await this.repo.inColumn(column.id)
      if (left.length === 0) return
      const columns = await this.deps.column.list(column.boardId)
      if (columns.some(each => each.id === column.id)) return
      const [first] = columns
      // Never none: a board keeps one column at least (`column.remove`).
      if (!first) return
      const bottom = await this.repo.count({ columnId: first.id })
      left.forEach((card, index) => card.moveTo(first.id, bottom + index, BOARDS))
      await this.repo.persistOrder(left, [column.id, first.id])
    })
  }
```

Step by step:

- It takes the column as `Pick<ColumnDTO, 'id' | 'boardId' | 'workspaceId'>`: what it
  needs of it. `column.removed` carries the whole DTO, which fits; a card's event
  hands just its column's id, board and workspace.
- A worker runs in no workspace. The column carries its `workspaceId`, so the use case
  enters it with `runInWorkspace` (as `notifyAssignee` did in [chapter
  12](./12-failures)), and the repositories see that workspace's rows.
- It looks for cards in the column. Almost always there are none, and it returns: the
  usual removal went through `removeColumn`, which checked, and the usual move goes to
  a column that stays.
- It reads the board's columns. If the column is still among them, it returns: the
  card is where it should be. This is the check that lets a card's worker call it after
  every move; and when a card's worker runs before the removal is saved, it is the
  column's own worker, later, that finds the card.
- The first column is the board's first one now, after the removal: `column.list`
  no longer shows the removed one. A board keeps one column at least, so there is
  always one; the `if (!first)` only tells TypeScript so.
- The cards go to the bottom of that column, in their order, with `moveTo` by
  `BOARDS`. Each tells `card.moved`, as any move does.
- `persistOrder` (from [chapter 8](./08-two-people-one-card)) saves them, guarding
  both columns and checking their order after writing. A card someone moved
  meanwhile is a conflict, and the use case runs again with what is there then.

Run it a second time and it finds no card in the removed column, and does nothing.
That matters, because a worker may run it more than once, and because now up to two
workers run it for the same card.

The column module's own comment on `remove` says the same, so that someone reading
it learns that a card can be left in the column, what happens to it, and why the last
column stays. Replace it in `column.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /**
   * Removes a column, and the ones to its right move one place left. Whether it is
   * empty is not known here, where cards are not: `card.removeColumn` asks the cards
   * first, and is what the API calls. A card left in it anyway (moved in at that very
   * moment) is taken to another column by a worker of the cards, so a board keeps one
   * column at least: its last one is not removed.
   */
  @UseCase()
  async remove(id: string): Promise<void> {
```

The subscriptions come below, with the others, in `card.workers.ts`.

## auth's events, as a port

Now Bea. boards wants to hear that someone lost their access. That event is auth's,
and there is no auth yet (it comes in [chapter 17](./17-auth)): nothing to import.

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
hands it: a fake auth now. Like `Workspaces`, it is a stand-in until auth exists: in
[chapter 20](./20-wiring-contexts) the card module is given auth's access module
itself, and subscribes to its `events.revoked`.

## Leaving the cards without an assignee

When Bea's access goes, her cards in that workspace lose their assignee. The same race
is here, in the other pair of saves. `card.assign` checks the assignee belongs
(`assertMember` asks auth, through the member module), then saves. Between the check
and the save, Bea can leave and auth's worker can run, find no card of hers yet, and be
done. Then the assignment lands, and Bea has a card in a workspace she is not in.
`card.create` with an assignee has the same gap.

The fix has the same shape. auth's worker runs after auth's save and looks at the
cards. The card's worker runs after the card's save and looks at auth: does the
assignee still belong? Whichever runs last sees both. Add `unassignMember` to
`card.module.ts`, after `notifyAssignee`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Someone may have lost their access to a workspace: if they do not belong to it,
   * its cards they had are left without an assignee. What a worker calls when auth
   * takes their access away, and when a card is given to someone (created for them,
   * or assigned): they were checked before its save, and may have left in between,
   * auth's worker finding no card of theirs yet. Each runs after its own save and
   * looks at the other's, so whichever runs last finds the card. Asked again here,
   * someone let in again since keeps their cards. Safe to run again.
   */
  @UseCase()
  async unassignMember(workspaceId: string, userId: string): Promise<void> {
    if (await this.deps.member.find(workspaceId, userId)) return
    await runInWorkspace(workspaceId, async () => {
      const cards = await this.repo.find({ assigneeId: userId })
      for (const card of cards) card.unassign(BOARDS)
      await this.repo.persist(...cards)
    })
  }
```

- First it asks whether the person belongs to the workspace now, with the member
  module's `find` (the one a worker uses, from [chapter 12](./12-failures)). If they
  do, it returns. That one line does three jobs. It is what makes the use case safe to
  call after **every** assignment: someone who belongs keeps their card. It closes the
  race from the card's side: someone who left is found gone. And someone who left and
  was let in again before auth's worker ran keeps their cards: the event says they
  left, but they belong now, and now is what counts.
- Then it enters the workspace, finds the cards assigned to that person there,
  unassigns each by `BOARDS`, and saves them all in one save. Each card tells
  `card.unassigned`, so the activity log records it, with no actor.

A second run finds no card of theirs, saves nothing, and is done.

## Which events: `when`, with a type guard

All the reactions go in `card.workers.ts`. Replace it:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
import type { CardAuthor, CardDTO } from './card.schema'
import type { Card_Deps, RevokedAccess } from './card.deps'
import type { Card_Module } from './card.module'

/** A new card, given to someone: what `when` lets through to check they still belong. */
type CreatedFor = CardDTO & CardAuthor & { assigneeId: string }

/**
 * What the cards do when something happens, each a job saved with what it reacts to,
 * run by a worker until it succeeds, and safe to run again.
 */
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them, by someone else.
  cards.events.created.subscribe(({ by, ...card }, { id }) => cards.notifyAssignee(card, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
    when: card => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto, by }, { id }) => cards.notifyAssignee(dto, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.assigned',
  })

  // A card points at its column: when a column goes, no card is left in it. A card
  // checks its column before its save, so the column may go in between: a card
  // created in one, or moved to one, looks again once saved. Whichever looks last finds it.
  deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.column.removed',
  })
  cards.events.created.subscribe(card => cards.leaveRemovedColumn({ id: card.columnId, boardId: card.boardId, workspaceId: card.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.created',
  })
  cards.events.moved.subscribe(({ dto }) => cards.leaveRemovedColumn({ id: dto.columnId, boardId: dto.boardId, workspaceId: dto.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.moved',
    when: ({ changes }) => changes.columnId !== undefined,
  })

  // auth took someone's access to a workspace: their cards there are left unassigned.
  // auth tells every access it takes away, to any product: only a workspace's is boards'.
  // A card checks its assignee before its save, so they may leave in between: a card
  // created for someone, or given to them, looks again once saved, the same way.
  // For now the product is named here: auth's WORKSPACES_PRODUCT (chapter 17) takes its place.
  deps.access.revoked.subscribe(access => cards.unassignMember(access.tenantId, access.userId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
    when: (access: RevokedAccess): access is RevokedAccess & { tenantId: string } => access.productId === 'cooper' && access.tenantId !== null,
  })
  cards.events.created.subscribe(card => cards.unassignMember(card.workspaceId, card.assigneeId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.card.created',
    when: (card: CardDTO & CardAuthor): card is CreatedFor => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto }) => cards.unassignMember(dto.workspaceId, dto.assigneeId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.card.assigned',
  })
}
```

Five new subscriptions, in two groups.

**The column.** `card.leaveRemovedColumn.on.column.removed` is the column's follower.
It is a `handler`, like the email of chapter 12: a job saved with the removal, in the
same transaction, and run until it completes. Its queue follows the name rule:
`card.leaveRemovedColumn`, the module and use case that react, `.on.column.removed`,
the event. Then the card's followers: `…on.card.created` hands the new card's column,
and `…on.card.moved` the column the card moved to. A move inside one column, or a
reorder, changes no column: its `when` lets through only a move whose `changes` say a
new `columnId`, so a card dragged within its column writes no job for this.

**The assignee.** `card.unassignMember.on.access.revoked` is auth's follower. auth tells
every access it takes away, to any product, and boards only wants the ones to a
workspace of cooper. Then the card's followers: `…on.card.created` for a card created
for someone, and `…on.card.assigned` for a card given to someone.

You met `when` in chapter 12, where a new card's email is sent only when it has an
assignee. Here it does a second job.

- **It decides which events get a job at all.** `when` runs in the transaction of the
  save that tells the event, before any job is written. An event it does not take
  leaves no job: a staff member losing the backoffice writes nothing for boards, and
  a card created with nobody assigned writes no job of `unassignMember`.
  It only looks at the payload; whether the event matters is `when`'s, never the use
  case's business logic.
- **Written as a type guard, it narrows what the callback gets.** The payload says
  `tenantId: string | null`, and `unassignMember` takes a `string`. The guard
  `(access: RevokedAccess): access is RevokedAccess & { tenantId: string }` tells
  TypeScript that whatever passes has a tenant, so the callback can hand
  `access.tenantId` straight to the use case. A `when` that returned a plain boolean
  would filter the same events, but the callback would still see `string | null`, and
  the call would not compile. Type the parameter, as here, for the guard to take.

`card.created`'s payload is the card and its author, with `assigneeId: string | null`.
The file names what its guard lets through, `CreatedFor`: a card with an assignee. The
guard `(card: CardDTO & CardAuthor): card is CreatedFor` turns `card.assigneeId` into
a `string` in the callback.

For now the product's name is written here as `'cooper'`. auth names it with a
constant, `WORKSPACES_PRODUCT`, which is not usable here until chapter 20; it replaces the
string then.

### An assignment always has an assignee

`card.assigned` has no `when`: an assignment always has an assignee. But its payload's
type did not say so. `dto` was a `CardDTO`, whose `assigneeId` is `string | null`, and
`unassignMember(dto.workspaceId, dto.assigneeId)` would not compile. Say it in the
event. In `events/card-assigned.ts`:

```ts
// cooper/backend/contexts/boards/modules/card/events/card-assigned.ts
import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card, now assigned to `dto.assigneeId`, who had it before, if anyone, and who assigned it. */
type CardAssignment = { dto: CardDTO & { assigneeId: string }, previousAssigneeId: string | null } & CardAuthor & { by: string }

export class Card_Assigned implements DomainEvent<CardAssignment> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardAssignment) {}
}
```

and in `card.ts`, `assign` builds the DTO with the assignee it was given, a `string`,
so that TypeScript sees it:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
  /** To a member of its workspace, by someone: the module checked they are. Assigning it again to the same one changes nothing. */
  assign(assigneeId: string, author: CardAuthor & { by: string }): void {
    const previousAssigneeId = this.data.assigneeId
    if (assigneeId === previousAssigneeId) return
    this.change({ assigneeId })
    this.trackEvent(new Card_Assigned({ dto: { ...this.toDTO(), assigneeId }, previousAssigneeId, ...author }))
  }
```

The JSON is the same as before: `toDTO()` already had that assignee.

## In any order

Here is the whole idea, for the two pairs of saves. Each column is one possible order
of the two workers:

| | The other side's worker runs first | The card's worker runs first |
|---|---|---|
| Card moved into, or created in, a column being removed | The column's worker finds no card yet. The card's, after the card's save, finds its column gone: it moves the card. | The card's worker finds its column still there. The column's, after the removal, finds the card in it: it moves the card. |
| Card given to, or created for, someone leaving | auth's worker finds no card of theirs yet. The card's, after the card's save, finds they left: it unassigns the card. | The card's worker finds they left: it unassigns the card. auth's, later, finds nothing more. |

Nothing locks, nothing waits, nothing asks the other
context to hold still. Each side does its own part after its own save, reads the
other's state as it is then, and the result is the same in every order. That is what
*eventually consistent* means here: for a moment a card may sit in a removed column, or
with an assignee who left; a moment later, whatever the order, it does not.

Two things make it hold:

- **Each follower checks the state, not the event.** `leaveRemovedColumn` asks whether
  the column is gone *now*, not whether some event said so; `unassignMember` asks
  whether the person belongs *now*. A follower that trusted its event would unassign
  someone let in again, or move a card out of a column that is still there.
- **Each follower is safe to run again, and safe to run for nothing.** Most of their
  runs find nothing to do. That is their normal case.

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

Here no reaction even crosses into another module: each is a use case of the card
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

The card's follower, `card.unassignMember.on.card.assigned`, is told in boards' store,
so its job is in boards' outbox. The two halves of the race are run by two different
workers, of two different contexts, each when it gets to it: nobody can say which runs
first. That is why each must check the other side, rather than count on an order.

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
import { Email } from 'newt/contract'
import { eventsOf, now, type DomainEvent } from 'newt/core'
import { Base } from 'newt/runtime'
import type { AccessEvents } from '../modules/card/card.deps'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'

type Access = { userId: string, productId: string, tenantId: string | null }

class Access_Revoked implements DomainEvent<Access> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = now().toISOString()
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
  `eventName`, the `name`, when it occurred (`now()`, the clock of `newt/core`, as your
  events use), and the payload.
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
    mailer,
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

### Pausing a use case: `hold`

The races need two things to happen in a precise order: a use case stopped between its
check and its save, and something else done meanwhile. In a test you make that order
yourself. In `card.test.ts`, import `spyOn` from `bun:test`:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
```

and add three helpers after `columns`:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  /** Where a card is now, and its assignee. */
  const card = (id: string) => inAcme(() => t.modules.card.get(id))
  /** The board's first column, where the cards of a removed one go. */
  const firstColumn = async () => (await inAcme(() => t.modules.column.list(boardId)))[0]!.id
  /**
   * The next call of a use case waits until `release`: before it runs, or after it
   * read what it answers. A use case paused between its check and its save, or
   * another one's, for something else to happen in between.
   */
  function hold<M extends object>(module: M, useCase: keyof M & string, at: 'before' | 'after') {
    const original = (module[useCase] as (...args: unknown[]) => Promise<unknown>).bind(module)
    const { promise: reached, resolve: reach } = Promise.withResolvers<void>()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()
    spyOn(module, useCase as never).mockImplementationOnce((async (...args: unknown[]) => {
      if (at === 'before') { reach(); await released }
      const answer = await original(...args)
      if (at === 'after') { reach(); await released }
      return answer
    }) as never)
    return { reached, release }
  }
```

- `card(id)` reads a card as it is now; `firstColumn()` is the board's first column,
  where the cards of a removed one go.
- `hold(module, useCase, at)` makes the **next** call of a use case wait. Bun's
  `spyOn` replaces the method on the module, and `mockImplementationOnce` only for one
  call; later calls run as usual. The replacement calls the original, and stops
  `'before'` it runs or `'after'` it answered. It resolves `reached` when it stops, and
  waits for `release`.

The trick is in which use case you hold. `card.move` checks its column by calling
`column.list`; hold `column.list` `'after'`, and the move has made its check and waits
before its save. `card.removeColumn` counts the cards, then calls `column.remove`; hold
`column.remove` `'before'`, and the removal has counted and waits before its save. In
the same way, holding `member.isMember` `'after'` stops an assignment that has checked
its assignee. A spy on another module's use case is a seam the test owns: nothing in
the card module changes for it.

### Seven races

Add the race tests after "moves a card only to a column of its board". The first two
are a move into a column being removed, once in each order:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('takes a card moved into a column being removed to the first column, when the column\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The move checked the column is there, and waits to save.
    const checked = hold(t.modules.column, 'list', 'after')
    const moving = inAcme(() => t.modules.card.move(plan.id, { columnId: done }))
    await checked.reached

    await inAcme(() => t.modules.card.removeColumn(done))
    // Its worker finds no card in it yet.
    await t.settled()
    checked.release()
    await moving
    expect((await card(plan.id)).columnId).toBe(done)

    // The card's worker, after its save, finds its column gone.
    await t.settled()
    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })
```

The move checks *Done* and stops. The removal runs whole: it counts no card in *Done*,
removes it, and `settled()` runs its worker, which finds nothing. Released, the move
saves #1 into *Done*, gone: the test sees it there, the gap of chapter 8. The second
`settled()` runs the card's worker, which finds its column gone and moves the card to
the first column.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('takes a card moved into a column being removed to the first column, when the card\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The removal found the column empty, and waits to save.
    const counted = hold(t.modules.column, 'remove', 'before')
    const removing = inAcme(() => t.modules.card.removeColumn(done))
    await counted.reached

    await inAcme(() => t.modules.card.move(plan.id, { columnId: done }))
    // The card's worker finds its column still there.
    await t.settled()
    counted.release()
    await removing
    expect((await card(plan.id)).columnId).toBe(done)

    // The column's worker, after its save, finds the card in it.
    await t.settled()
    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })
```

The other order. The removal counts no card and stops before removing. The move goes
in whole, and its worker finds *Done* still there: nothing to do. Released, the removal
saves; its worker finds #1 in *Done* and moves it.

A card created in a column being removed:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('takes a card created in a column being removed to the first column', async () => {
    const checked = hold(t.modules.column, 'list', 'after')
    const creating = create('Plan', { columnId: done })
    await checked.reached
    await inAcme(() => t.modules.card.removeColumn(done))
    await t.settled()
    checked.release()
    const plan = await creating

    await t.settled()

    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })
```

Then the assignee, in each order:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('leaves unassigned a card given to someone as they leave the workspace, when auth\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The assignment checked bea belongs, and waits to save.
    const checked = hold(t.modules.member, 'isMember', 'after')
    const assigning = inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await checked.reached

    await t.auth.revoke('acme', 'bea')
    // auth's worker finds no card of hers yet.
    await t.settled()
    checked.release()
    await assigning
    expect((await card(plan.id)).assigneeId).toBe('bea')

    // The card's worker, after its save, finds she has left.
    await t.settled()
    expect((await card(plan.id)).assigneeId).toBeNull()
    expect(t.mails).toEqual([])
  })
```

The assignment checks Bea and stops. She leaves, and `settled()` runs auth's worker,
which finds no card of hers. Released, the assignment saves: #1 is Bea's, for a
moment. The next `settled()` runs the card's followers: `unassignMember` finds she
left and unassigns; `notifyAssignee` finds she left and sends nothing.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('leaves unassigned a card given to someone as they leave the workspace, when the card\'s worker runs first', async () => {
    const plan = await create('Plan')
    const checked = hold(t.modules.member, 'isMember', 'after')
    const assigning = inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await checked.reached
    // She has left, and auth's worker has not run yet.
    await t.auth.revoke('acme', 'bea')
    checked.release()
    await assigning

    // The card's worker, after its save, finds she has left; auth's, after, finds nothing more.
    await t.boards.base.jobs.idle()
    expect((await card(plan.id)).assigneeId).toBeNull()
    await t.settled()
    expect((await card(plan.id)).assigneeId).toBeNull()
    expect(t.mails).toEqual([])
  })
```

Here auth's worker must wait, so the test does not call `settled()`, which runs auth's
jobs first. It runs only boards' jobs, with `t.boards.base.jobs.idle()`: the card's
worker finds Bea gone and unassigns. Then `settled()` runs auth's worker, which finds
nothing more.

A card created for someone leaving, and someone who comes back:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('leaves unassigned a card created for someone as they leave the workspace', async () => {
    const checked = hold(t.modules.member, 'isMember', 'after')
    const creating = create('Plan', { assigneeId: 'bea' })
    await checked.reached
    await t.auth.revoke('acme', 'bea')
    await t.settled()
    checked.release()
    const plan = await creating

    await t.settled()

    expect((await card(plan.id)).assigneeId).toBeNull()
  })

  test('keeps the cards of someone let in again before auth\'s worker ran', async () => {
    const plan = await create('Plan', { assigneeId: 'bea' })
    await t.auth.revoke('acme', 'bea')
    t.auth.join('acme', 'bea')

    await t.settled()

    expect((await card(plan.id)).assigneeId).toBe('bea')
  })
```

The last one is the reason `unassignMember` asks before it acts. Bea leaves and joins
again before auth's worker runs. The event says she left; she belongs now, and keeps
her card.

### The column's own worker

Last, after the test of the email to nobody, the removed column with a card already in
it. The test calls `column.remove` directly, skipping `removeColumn`'s check, which is
what the race leaves behind:

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
bun install && bun check && bun test cooper && bun run lint
```

```text
 52 pass
 0 fail
```

The new tests on their own:

```sh
bun test cooper -t 'credits nobody|being removed|removed column|leave the workspace|let in again'
```

```text
 9 pass
 43 filtered out
 0 fail
 15 expect() calls
Ran 9 tests across 6 files.
```

## What to remember

- While another context is not built yet, what a module needs of it is a port in its
  own deps, in its own words. For events, an `EventSource<T>`: only `subscribe`. A
  test hands its own; the other context's modules take its place once it exists.
- `when` picks which events get a job, in the transaction that tells them, so an
  event it does not take leaves nothing. Written as a type guard with a typed
  parameter, it narrows what the callback gets.
- Only a worker writes into another module. A consequence in someone else's data is an
  event told and a reaction from a worker, never a direct write.
- When two saves race (a check, then a save, on each side), give each side a follower
  that runs after its own save and checks the other side's state now. Whichever runs
  last sees both, so the result is the same in any order.
- What boards does on its own is done by nobody: `{ by: null, via: null }`. A worker
  has no actor, and enters the workspace the event names with `runInWorkspace`.
- A reaction may run twice, or for nothing. Make those runs find nothing to do: no card
  left in the column, no card of theirs left assigned, a column still there left alone.

Next: [Sagas: a workspace comes and goes](./14-sagas).
