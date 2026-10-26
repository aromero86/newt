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
import type { CardDTO } from '../card.schema'

/** The card, now assigned to `dto.assigneeId`, and who had it before, if anyone. */
type CardAssignment = { dto: CardDTO, previousAssigneeId: string | null }

export class Card_Assigned implements DomainEvent<CardAssignment> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardAssignment) {}
}
```

The name is `<module>.<what happened>`. The payload is plain data (DTOs, strings,
numbers), never an entity: it is written to the database and read back later,
maybe by another version of the code.

## The entity tells it

You saw it in [your first module](./03-first-module): the entity notes its events with
`trackEvent`, inside the method that makes the change. Nobody else does.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
/** To a member of its workspace: the module checked they are. Assigning it again to the same one changes nothing. */
assign(assigneeId: string): void {
  const previousAssigneeId = this.data.assigneeId
  if (assigneeId === previousAssigneeId) return
  this.change({ assigneeId })
  this.trackEvent(new Card_Assigned({ dto: this.toDTO(), previousAssigneeId }))
}

unassign(): void {
  const previousAssigneeId = this.data.assigneeId
  if (previousAssigneeId === null) return
  this.change({ assigneeId: null })
  this.trackEvent(new Card_Unassigned({ dto: this.toDTO(), previousAssigneeId }))
}
```

Look at the early `return`s. Assigning a card to the person who already has it
changes nothing, so it tells nothing. A listener never gets an event for a change
that did not happen.

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
static create(input: CardOpening): Card {
  const card = new Card(input, true)
  card.trackEvent(new Card_Created(card.toDTO()))
  return card
}

// …
place(number: number, position: number): void {
  if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
  this.change({ number, position })
  this.trackEvent(new Card_Created(this.toDTO()))
}
```

The save publishes one `card.created`, not two, because:

> An entity tells at most one event of each kind (each name) per save. A second one
> of the same kind replaces the first.

The last one is built from the entity as it is now, so it tells everything: here,
the card with its real number. This is the whole rule, in newt's `Entity`:

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
edit(changes: { title?: string, description?: string }): void {
  this.change(changes)
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Card_Edited({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
}

/** Someone moved it: to this column, at this position. */
moveTo(columnId: string, position: number): void {
  this.change({ columnId, position })
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Card_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
}
```

- `dto`: the card as it is now, whole.
- `changes`: the fields that changed since it was loaded.
- `previous`: what those fields were before.

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
whoever subscribes to `card.events.assigned` receives a `{ dto, previousAssigneeId }`.

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
- A module offers its events with `eventsOf`, under `events`. Once someone listens,
  they are a contract.
