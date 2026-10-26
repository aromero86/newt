# Reacting to an event

The card module tells `card.assigned`. Now someone has to email the assignee. This
chapter shows how a module reacts to an event: the two ways to subscribe, the job
newt saves with the change, the name of its queue, and the worker that calls a use
case.

## Always the same: subscribe

A module reacts to an event, its own or another module's, by subscribing to it:

```ts
<module>.events.<event>.subscribe(callback, options)
```

The options say the strategy. There is no default: you choose each time, on purpose.

| | `'fire-and-forget'` | `'handler'` |
|---|---|---|
| When it runs | Right after the commit. | Right after the commit. |
| If it fails | It is lost. | It runs again later, waiting longer each time. |
| If the server stops first | It is lost. | It runs when the server is back. |
| Where it lives | In memory. | A job, saved in the store. |
| What for | What you can lose: clearing a cache, a metric. | Everything that matters: an email, a change in another module. |

`'fire-and-forget'` is as simple as it sounds. cooper's own code never uses it; its
tests do, to count events (you saw it in the [previous chapter](./10-events)):

```ts
// cooper/backend/contexts/auth/auth.test.ts
modules().access.events.revoked.subscribe(access => { told.push(access.userId) }, { strategy: 'fire-and-forget' })
```

`'handler'` is the one you will use almost always. If in doubt, use it: almost
everything a backend does matters.

Each strategy takes its own options, and TypeScript only lets you write those:
`'fire-and-forget'` takes nothing else; `'handler'` takes its `queue` and, if
needed, `attempts`.

## A module's reactions: `<module>.workers.ts`

A module's reactions live in its `<module>.workers.ts`, a function its `initialize`
calls. These are the card module's:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them.
  cards.events.created.subscribe(async card => {
    if (card.assigneeId !== null) await cards.notifyAssignee(card)
  }, {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
  })
  cards.events.assigned.subscribe(({ dto }) => cards.notifyAssignee(dto), {
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
  deps.access.revoked.subscribe(async access => {
    if (access.productId === WORKSPACES_PRODUCT && access.tenantId !== null) await cards.unassignMember(access.tenantId, access.userId)
  }, {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
  })
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
static initialize(base: BoardsBase, deps: Card_Deps, options: Card_Options): Card_Module {
  const module = new Card_Module(base, new Card_Repository(base), deps, options)
  registerCardRoutes(base, module, deps)
  registerCardWorkers(module, deps)
  return module
}
```

Read it aloud: "when a card is assigned, the card module notifies its assignee";
"when a column is removed, the cards leave it"; "when auth revokes an access, the
cards unassign that member". Four reactions, three sources: the module's own events,
another module's (`column`), and another context's (`access`, in auth).

- The callback receives the event's payload and calls one use case of the module
  that reacts, with what that use case needs: here `dto`, not the whole payload.
- The callback may decide whether the event concerns it. A card created without an
  assignee needs no email. auth revokes accesses to every product, and only a
  workspace's matters here. That is a condition on the event, never business logic:
  that belongs in the use case.

The cards module does not receive `access` as auth's module. It receives a port in its
own words, which only says it can be subscribed to:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
export type AccessEvents = {
  /**
   * Someone lost their access to a product of auth's: to a workspace of `cooper`
   * (`tenantId`), or to a product with none (null, the backoffice's staff).
   */
  revoked: Pick<DomainEventEmitter<{ userId: string, productId: string, tenantId: string | null }>, 'subscribe'>
}
```

auth's `access.events` fits it, and a test hands its own. [Several contexts](./19-several-contexts)
comes back to this.

## A job, saved with the change

Each `'handler'` reaction is a job. newt writes it in the same transaction as the
change that tells the event: you saw `this.jobs.enqueue(event)` inside `publish` in
the previous chapter. That is all of it:

```ts
// packages/newt/runtime/jobs/job-queue.ts
/** One job for each handler the event concerns, in the transaction of the save that publishes it. */
async enqueue(event: DomainEvent): Promise<void> {
  const now = new Date().toISOString()
  const jobs: Job[] = [...this.registrations]
    .filter(([, registration]) => eventNameMatches(registration.pattern, event.name))
    .map(([queue]) => ({ id: Bun.randomUUIDv7(), queue, event: JSON.stringify(event), status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now }))
  if (jobs.length > 0) await this.store.add(jobs)
}
```

So the assignment and the job "notify its assignee" are saved together, or neither
is. The table they go to is the outbox: a table of jobs in the same store as the data.
After the commit, the worker wakes up, claims the job and runs the callback:

```text
one transaction                         after the commit
┌─────────────────────────────────┐
│ card: assigneeId = bea          │ ──▶ the worker claims the job
│ job: card.notifyAssignee.on.    │     and runs card.notifyAssignee(dto)
│      card.assigned (pending)    │     failed? it runs again later
└─────────────────────────────────┘
```

The job keeps the event as JSON, exactly as it was published. That matters for
[what you put in a payload](./14-irreversible).

### Whose worker runs it

The job goes to the outbox of the context whose emitter you subscribed to. boards
subscribes to auth's `tenant.created` and `access.revoked` on auth's emitters, so
those jobs are saved in auth's database, with auth's change, and auth's worker runs
them. cooper says so where it wires the two:

```ts
// cooper/backend/open-contexts.ts
/**
 * What `boards` asks of auth, wired to auth's use cases and events. A workspace is a
 * tenant of the product `cooper`, and its members are those with access to it.
 * boards' reactions to auth's events are subscribed on auth's emitters: they are jobs
 * of auth's outbox, run by auth's worker (`auth.base.jobs.idle()`, then boards').
 */
```

That is what makes a reaction across contexts safe: the workspace and the job that
gives it its board are in the same transaction, in auth's store. A job in boards'
store could not be.

## The name of its queue

The jobs of each reaction wait in a queue, and the queue has a name that finds it
again after a restart. You write it whole, always in the same shape: the module that
reacts, its use case, and the event.

```text
<module that reacts>.<use case>.on.<event>

card.notifyAssignee.on.card.assigned
card.unassignMember.on.access.revoked
workspace.prepare.on.tenant.created
```

Read aloud, it says what it does. An event can have several reactions in one module
(two use cases), and each one has its own queue: `card.notifyAssignee.on.card.created`
and `card.notifyAssignee.on.card.assigned` are two queues of the same use case.

newt checks the shape when you subscribe. If the queue does not end in the event you
subscribe to, the context fails to open, not in production at midnight:

```ts
// packages/newt/core/events/domain-event-emitter.ts
const { queue, attempts } = subscription
if (!QUEUE.test(queue) || !queue.endsWith(`.on.${this.name}`)) {
  throw new Error(`A handler's queue is '<module>.<use case>.on.${this.name}': '${queue}' is not`)
}
```

There is a consequence. Renaming a queue (because you renamed the use case or the
module) leaves its pending jobs under the old name, which no worker serves. newt
does not let that pass in silence: the worker checks at start and then every minute,
and warns once about each queue with jobs that no worker has served for five minutes:

```ts
// packages/newt/runtime/jobs/job-queue.ts
console.warn(`[JobQueue] ${jobs} job(s) of '${queue}' wait, and no worker serves that queue: was its handler renamed or removed?`)
```

If you rename one, do it when its queue is empty, or move its pending jobs with a
migration.

## A worker calls a use case

A worker never writes on its own: it calls a use case of its module. The logic lives
in one place, and the use case can be tested, traced and called from wherever it is
needed. The callback does nothing else.

This is the use case behind `card.assigned`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Tells the assignee of a card they have it, by email: from a worker, once the
 * assignment is saved, since an email cannot be taken back (ch. 16). Run late, it
 * reads the card again: if it is gone, or has another assignee by then, there is
 * nothing to tell (that assignment tells its own).
 */
@UseCase()
async notifyAssignee(card: CardDTO): Promise<void> {
  if (card.assigneeId === null) return
  const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
  if (current?.assigneeId !== card.assigneeId) return
  const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
  if (!member) return
  const link = new URL(`/workspaces/${card.workspaceId}/boards/${card.boardId}?card=${card.number}`, this.options.publicUrl)
  await this.options.mailer.send({
    to: member.email,
    subject: `#${card.number} ${card.title} is yours`,
    text: [`Hi ${member.name},`, '', `Card #${card.number}, "${card.title}", is assigned to you.`, '', link.toString()].join('\n'),
  })
}
```

A worker runs with nothing around it: no actor, no scope. Not the person who assigned
the card, nor anyone else. newt runs each job detached from whoever committed,
started the worker or waits for it:

```ts
// packages/newt/runtime/jobs/job-queue.ts
/**
 * No context at all: this module's, taken as it loads, before any request or script
 * enters a scope. Jobs run in it, never in that of whoever made the queue (a context
 * opened lazily, inside a request), started the worker or waits for it (`idle`), so
 * a handler has no actor nor scope but the ones it sets itself.
 */
const detached = AsyncLocalStorage.snapshot()
```

So the use case sets what it needs itself, from the event:

- The workspace: `runInWorkspace(card.workspaceId, …)` enters the
  [workspace scope](./05-who-and-where) without checking anyone, because a worker
  already knows. The card repository is scoped to a workspace and would refuse to
  read outside one.
- The member: `member.find(workspaceId, userId)` takes the workspace as an argument,
  where `member.isMember(userId)` reads it from the scope. One is for requests, the
  other for workers.
- `currentActor()` would throw here, and the job would fail on every attempt until it
  died. If a use case needs to know who did something, it reads it from the data, or
  the event carries it.

The mailer is an option of the module, given by the context: the console in
development, a list in tests, an email service in production. The module does not
know which.

```ts
// cooper/backend/contexts/boards/modules/card/card-options.ts
/** What the context configures the cards with. */
export type Card_Options = {
  /** What tells an assignee: the console in development, a list in a test. */
  mailer: Mailer
  /** Where people open boards: the links of its emails start there. */
  publicUrl: string
}
```

## Check it

The worker runs only after the commit, so a test has to wait for it. `jobs.idle()`
resolves once no job is ready nor running. boards' tests wait for auth's worker first
(boards' reactions to auth run there), then boards' own:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
/** Until the background work is done: auth's events heard, and what they made boards tell. */
async settled(): Promise<void> {
  await auth.idle()
  await boards.base.jobs.idle()
},
```

Then the test assigns a card, sees no email yet, waits, and sees one:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('assigns a card only to a member of its workspace, and tells them by email once saved', async () => {
  const plan = await create('Plan')

  await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })

  await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
  expect(t.mails).toEqual([])
  await t.settled()
  expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#1 Plan is yours']])
  expect(t.mails[0]!.text).toContain(`/workspaces/acme/boards/${boardId}?card=1`)
  // …
})
```

Run it with `bun test cooper/backend/contexts/boards/modules/card`. In development,
assign a card in the app and watch the server's console: the email is printed there
a moment later.

## In short

- A module reacts by subscribing to an event, always with a strategy:
  `'fire-and-forget'` for what you can lose, `'handler'` for everything else.
- A module's reactions live in `<module>.workers.ts`, called from its `initialize`.
- A `'handler'` is a job saved in the same transaction as the change, and run by a
  worker after the commit. It lives in the outbox of the context whose event it is.
- Its queue is `<module that reacts>.<use case>.on.<event>`. Rename it only when it is
  empty.
- The callback only decides whether the event concerns it and calls one use case.
- A worker has no actor and no scope: the use case sets what it needs from the event.
