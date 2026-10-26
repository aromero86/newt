# Events: telling what happened

Until now every use case did its work and answered. But some changes matter to
someone else. When a card is assigned, its assignee should hear of it. When auth
deletes a workspace, boards has to delete its boards. The card module should not
know about email, and auth should not know that boards exists.

newt solves this with events. A module tells what happened, and whoever cares
listens. This chapter is about telling. The next one is about listening.

## What an event is

An event is something that already happened, named in the past tense:
`card.assigned`, `tenant.created`, `access.revoked`. The module that tells it does not
know who listens, or whether anyone does.

In cooper each event is a small class in its module's `events` folder. It has a
name, the moment it happened, and a payload:

```ts
// cooper/backend/contexts/boards/modules/card/events/card-assigned.ts
import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/** The card, now assigned to `dto.assigneeId`, who had it before, if anyone, and who assigned it. */
type CardAssignment = { dto: CardDTO, previousAssigneeId: string | null } & CardAuthor & { by: string }

export class Card_Assigned implements DomainEvent<CardAssignment & CardEventStamp> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardAssignment & CardEventStamp
  constructor(assignment: CardAssignment) {
    this.payload = { ...assignment, ...cardEventStamp() }
  }
}
```

The name is `<module>.<what happened>`. The payload is plain data (DTOs, strings,
numbers), never an entity: it is written to the database and read back later,
maybe by another version of the code.

## What every card event carries

Look at what a card's payload holds besides the card. Two things, the same in all six
of its events.

Who did it. `by` is the user's id and `via` how they came in: the web, or an AI
assistant through the [MCP server](./21-mcp-server). Both are `null` when boards did
it on its own, from a worker, with nobody behind it:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
/**
 * Who does something to a card, as its events tell it: their user's id (`by`) and how
 * they came in (`via`, the web or MCP). Both null for boards' own work, which a worker
 * does with no one behind it (ch. 13.5): a workspace's welcome card, the cards a
 * removed column or a member who left leaves behind.
 */
export type CardAuthor = { by: string | null, via: ActorVia | null }
```

An assignment always has someone behind it, so `Card_Assigned` narrows it to
`{ by: string }`.

The event's own id and time. A listener sees only the payload, never the event
object around it, so whatever it needs to know about the event itself must be in
there:

```ts
// cooper/backend/contexts/boards/modules/card/events/card-event-stamp.ts
/**
 * What every event of a card carries besides what happened: its own id and when it
 * was told. A handler sees only the payload, so whoever reacts once per event (the
 * activity log) keys on this id.
 */
export type CardEventStamp = { eventId: string, at: string }

export function cardEventStamp(): CardEventStamp {
  return { eventId: Bun.randomUUIDv7(), at: new Date().toISOString() }
}
```

Why the author goes in the event, and is not read later: a worker that reacts runs
with [no actor](./11-reacting#a-worker-calls-a-use-case). The person who moved the
card is known only now, while the use case runs. If a listener will need it, the
event has to carry it. The `eventId` is what lets a listener
[do its work once](./13-repeatable-workers) however many times its job runs.

## The entity tells it

You saw it in [your first module](./03-first-module): the entity notes its events with
`trackEvent`, inside the method that makes the change. Nobody else does.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
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
```

Look at the early `return`s. Assigning a card to the person who already has it
changes nothing, so it tells nothing. A listener never gets an event for a change
that did not happen.

The entity does not know who is acting: the module tells it. A use case a route or an
MCP tool called passes the person acting now; a use case a worker calls passes
`BOARDS`, nobody:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** Boards' own work, from a worker: no one did it. */
const BOARDS: CardAuthor = { by: null, via: null }

/** The person acting now, as a card's events tell it: a use case a route or an MCP tool called. */
function actingAuthor(): CardAuthor & { by: string } {
  const { userId, via } = currentActor()
  return { by: userId, via }
}

// …
@UseCase()
async assign(id: string, input: CardAssignDTO): Promise<CardDTO> {
  const { assigneeId } = CardAssignSchema.parse(input)
  const card = await this.load(id)
  await this.assertMember(assigneeId)
  card.assign(assigneeId, actingAuthor())
  await this.repo.persist(card)
  return card.toDTO()
}
```

`via` is not a newt field. newt's actor knows one thing, its user; cooper adds how
they came in, once, for every program:

```ts
// cooper/backend/shared/actor.ts
export type ActorVia = 'web' | 'mcp'

// …
declare module 'newt/core' {
  interface Actor {
    via: ActorVia
  }
}
```

## When it is published

Noting an event is not publishing it. The repository publishes the entity's events
when it saves it, inside the save's transaction. This is newt's `save`, the one every
repository method ends in:

```ts
// packages/newt/repository/repository.ts
protected async save<T extends E>(entities: T[], write: (entity: T) => void | Promise<void>, hooks: SaveHooks = {}): Promise<void> {
  // …
  await this.store.transaction(async () => {
    // …
    for (const entity of changed) {
      await write(entity)
      entity[markPersisted]()
    }
    await hooks.after?.()
    for (const entity of entities) {
      const events = entity[takeEvents]()
      // One that ends as it was read has nothing to tell: a change undone is no change.
      if (!changed.has(entity)) continue
      for (const event of events) await this.base.publisher.publish(event)
    }
  })
}
```

And this is what publishing does, in the context's `Base`:

```ts
// packages/newt/runtime/base.ts
this.publisher = {
  publish: async event => {
    await this.jobs.enqueue(event)
    this.store.afterCommit(() => {
      memory.publish(event)
      this.jobs.wake()
    })
  },
}
```

Two things happen. The durable reactions to the event are written as jobs, in the
same transaction as the change (the next chapter is about them). Everything else
waits for the commit. So:

> An event is published when the transaction that saved it commits. If the
> transaction rolls back, the event never existed.

Nobody ever reacts to a card assignment that was not saved.

## One event of each kind per save

A card is created in two steps. `Card.create` builds it with the number and position
it looked to get, and notes `card.created`. Then the repository gives it the number
and position it really gets, inside the save (see
[values everyone changes](./09-shared-counters)), and `place` notes `card.created`
again:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
static create(input: CardOpening, author: CardAuthor): Card {
  const card = new Card(input, true)
  card.author = author
  card.trackEvent(new Card_Created({ ...card.toDTO(), ...author }))
  return card
}

// …
place(number: number, position: number): void {
  if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
  this.change({ number, position })
  this.trackEvent(new Card_Created({ ...this.toDTO(), ...this.author! }))
}
```

The save publishes one `card.created`, not two, because:

> An entity tells at most one event of each kind (each name) per save. A second one
> of the same kind replaces the first.

The last one is built from the entity as it is now, so it tells everything: here,
the card with its real number, and a fresh `eventId`. This is the whole rule, in newt's `Entity`:

```ts
// packages/newt/core/entity/entity.ts
protected trackEvent(event: DomainEvent): void {
  this.domainEvents = [...this.domainEvents.filter(each => each.name !== event.name), event]
}
```

Two different kinds in one save are allowed, but they usually mean the use case does
two things. In cooper each use case takes an entity from one state to the next and
tells it once.

## What a change tells: before and after

A `created` event carries the whole entity as a DTO. An event about a change carries
more, because a listener usually wants to know what changed. Look at `edit` and
`moveTo`:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
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
```

- `dto`: the card as it is now, whole.
- `changes`: the fields that changed since it was loaded.
- `previous`: what those fields were before.
- `by` and `via`, `eventId` and `at`, as every card event.

A listener that keeps a history of moves can write "from Doing to Done" without
reading anything. And the `if (diff)` again: saving the same title tells nothing.

`card.assigned` does the same with fewer fields: the card, and `previousAssigneeId`.
Shape each payload for what a listener needs to know.

Not every change is worth an event. When a card moves, the cards around it take the
places left (`reposition`), and they tell nothing: nobody moved them.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
/** Another one moved, or left: this one takes the place left to it in its column, and tells nothing. */
reposition(position: number): void {
  this.change({ position })
}
```

## Offering the events: `events`

Each module offers its events under `events`, built with `eventsOf` from the event
classes. That is where others subscribe:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
readonly events

private constructor(
  base: BoardsBase,
  private readonly repo: Card_Repository,
  private readonly deps: Card_Deps,
  private readonly options: Card_Options,
) {
  super('card', base.invocations)
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

From outside they read as what they are: `card.events.assigned`. And they are typed:
whoever subscribes to `card.events.assigned` receives a
`{ dto, previousAssigneeId, by, via, eventId, at }`.

auth does the same, and its events are the ones other contexts listen to:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
this.events = eventsOf(base.bus, { created: Tenant_Created, renamed: Tenant_Renamed, deleted: Tenant_Deleted })
```

Once another module, or another context, listens to an event, its name and its
payload are a contract. [When something fails](./15-failures) explains why its shape
can only grow.

## Check it

A test can listen to an event the simplest way (you will see the options in the next
chapter) and count what it hears. This test in auth deletes a workspace with two
members and checks that an `access.revoked` was told for each one:

```ts
// cooper/backend/contexts/auth/auth.test.ts
const told: string[] = []
modules().access.events.revoked.subscribe(access => { told.push(access.userId) }, { strategy: 'fire-and-forget' })

// …
await as(ana, () => modules().tenant.delete(acme.id))
// …
await settled()

// …
expect(told.sort()).toEqual([ana.id, bob.id].sort())
```

And the card tests check the other side: assigning a card again to the same person
tells nothing, so no second email leaves.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
// Assigning it again to the same one changes nothing, and tells nothing.
await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
await t.settled()
expect(t.mails).toHaveLength(1)
```

## In short

- An event is something that already happened, named in the past tense:
  `<module>.<what happened>`. Its payload is plain data.
- The entity notes it with `trackEvent`, in the method that makes the change. No
  change, no event.
- The repository publishes it with the save: it exists only if the transaction commits.
- At most one event of each kind per save: the last one replaces the others.
- A change event carries `dto`, `changes` and `previous`.
- Whatever a listener will need and only the moment knows goes in the payload: who
  acted (`by`, `via`), and the event's own id and time.
- A module offers its events with `eventsOf`, under `events`. Once someone listens,
  they are a contract.
