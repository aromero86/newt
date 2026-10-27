# Reacting: handlers and the outbox

The line in the log can be lost, and nothing is wrong. A card's **history** cannot.
cooper shows, for each card, what happened to it, who did it and how they came in:
created by ana, moved by ana through MCP, assigned to bea. A history with a hole in
it is a bug, and with `fire-and-forget` a hole is one crash away: the move is saved,
the process stops before the callback runs, and the history never hears of it.

Writing the history inside `card.move` would not help either. The activity is another
module, with its own table and its own save: a use case that saved the card and then
the entry could fail between the two, and that is the write to another module chapter
[8](./08-two-people-one-card) said only a worker may do.

This chapter adds the strategy that loses nothing, **`handler`**. newt writes a
**job** in the same transaction as the change, and a worker runs it after the commit,
again if it fails, after a restart too. The activity module records each card event
with one, and you will see what that costs: a job may run more than once, so what it
does must be safe to do twice.

## A job, saved with the change

A subscription with `strategy: 'handler'` is a **queue**. Each time its event is told,
newt adds a job to that queue, in the transaction of the save that told it:

```text
one transaction                          after the commit
┌──────────────────────────────────┐
│ card: columnId = Doing           │ ──▶ boards' worker claims the job,
│ job:  activity.recordMoved.on.   │     runs activity.recordMoved(move, event),
│       card.moved      (pending)  │     and marks it done; if it throws,
└──────────────────────────────────┘     it runs again later
```

So the move and the job that records it are saved together, or neither is. There is
no moment where the card moved and the job does not exist. The table they go to is
the context's **outbox**: a table of jobs in the same store as its data, `job`, which
`SqliteStore.open` created with newt's own migrations in chapter
[5](./05-sqlite). The job keeps the event as JSON, exactly as it was told, payload and
all.

After the commit, the context's **worker** runs it. You started it in chapter
[1](./01-project-and-context): `boards.start()` in `index.ts`. The commit wakes it, so
a job usually runs a moment after its save; it also looks every few seconds, and when
it starts, so jobs left from before a restart run too. A job that throws goes back to
wait and runs again later (the [next chapter](./12-failures) says how often, and when it
stops trying).

The worker runs each job **detached**: no actor, no scope, nothing of whoever saved
the change. A job reads what it needs from the event, as the log line did.

### At least once

A job runs until it succeeds. That is the guarantee, and it has a price: it may run
**more than once**. Between doing its work and marking the job done there is always a
moment, and the process may stop in it. When the worker is back, the job is still
pending, and it runs again. A job that failed halfway runs again from the start. A
worker that froze past its lease (a minute, renewed while it runs) loses the job to
another, and may still finish its own run.

So whatever a handler does must give the same result run twice as run once: it must
be **idempotent**. Keep this in mind for the activity: each card event must give one
entry, however many times its job runs.

## The table

An entry of a card's activity is a row, and rows are only ever added. Each row's id is
the id of the event it records:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00005_activity_up.sql
-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT,
  via TEXT,
  at TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- A card's activity, the newest first (ids are v7: in the order they were told).
CREATE INDEX activity_card ON activity (workspace_id, card_id, id);
```

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00005_activity_down.sql
DROP TABLE activity;
```

- `actor_id` and `via` are null when boards did it on its own (a removed column's
  cards, later).
- `detail` is JSON: what changed, by kind.
- There is no foreign key to `card`: a card deleted keeps its history.
- The index reads a card's activity newest first. The ids are UUID v7, ordered by
  time, so ordering by id is ordering by when each event was told.

## The entry

Its schema says what an entry is, and the six kinds:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.schema.ts
import { z } from 'zod'

/** What can happen to a card: one entry of its activity each. */
export const ACTIVITY_KINDS = ['created', 'edited', 'moved', 'assigned', 'unassigned', 'deleted'] as const

/**
 * Something that happened to a card, once: who did it (`actorId`, null when cooper
 * did it on its own) and how they came in (`via`), and what changed (`detail`). Its
 * id is the id of the event it records, so the same event is recorded once.
 */
export const ActivitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  cardId: z.string(),
  kind: z.enum(ACTIVITY_KINDS),
  actorId: z.string().nullable(),
  via: z.enum(['web', 'mcp']).nullable(),
  /** When it happened: when its event was told. */
  at: z.string(),
  /**
   * What changed, by kind: `number` and `title` (created, deleted), `changed` and
   * `title` (edited), `fromColumnId` and `toColumnId` (moved), `assigneeId` and
   * `previousAssigneeId` (assigned, unassigned).
   */
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type ActivityDTO = z.infer<typeof ActivitySchema>
export type ActivityKind = ActivityDTO['kind']
```

The entity is the smallest in cooper. It is recorded once, never changed, and tells
nothing: it is itself what a card's events told.

```ts
// cooper/backend/contexts/boards/modules/activity/activity.ts
import { Entity, type EntityInput } from 'newt/core'
import { ActivitySchema, type ActivityDTO } from './activity.schema'

export * from './activity.schema'

/**
 * An entry of a card's activity. Recorded once and never changed: a log only grows,
 * so two entries written at once never collide. It tells nothing: it is
 * itself what a card's events told.
 */
export class Activity extends Entity<typeof ActivitySchema> {

  private constructor(input: EntityInput<ActivityDTO>, isNew: boolean) {
    super(ActivitySchema, input, isNew)
  }

  static fromDTO(dto: ActivityDTO & { version: number }): Activity {
    return new Activity(dto, false)
  }

  /** A new entry, by the id of the event it records. */
  static record(input: EntityInput<ActivityDTO> & { id: string }): Activity {
    return new Activity(input, true)
  }
}
```

`record` takes the id from outside, the event's, instead of a new one. That is what
makes it idempotent, below.

The repository is scoped to the workspace like every repository of boards (chapter
[4](./04-who-and-where)), and says `detail` is stored as JSON:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Activity, type ActivityDTO } from './activity'

export type ActivityRow = ActivityDTO & { version: number }

export class Activity_Repository extends TableRepository<Activity, ActivityRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<ActivityRow>('activity', { types: { detail: 'json' } }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: ActivityRow): Activity {
    return Activity.fromDTO(row)
  }
}
```

## The use cases

The module gets a repository, its routes, a use case that reads, and six that record,
and its comment says what it is now: a log that only grows. This is the whole
`activity.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
import { mapPage, Module, UseCase, type EventMeta, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { CardAuthor, CardDTO } from '../card/card.schema'
import type { Card_Assigned } from '../card/events/card-assigned'
import type { Card_Created } from '../card/events/card-created'
import type { Card_Deleted } from '../card/events/card-deleted'
import type { Card_Edited } from '../card/events/card-edited'
import type { Card_Moved } from '../card/events/card-moved'
import type { Card_Unassigned } from '../card/events/card-unassigned'
import { Activity, type ActivityDTO, type ActivityKind } from './activity'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Options } from './activity-options'
import { Activity_Repository } from './activity.repository'
import { registerActivityRoutes } from './activity.routes'
import { registerActivityWorkers } from './activity.workers'

/**
 * What happened to each card, and who did it: a log that only grows, one
 * entry per event a card tells, written by a worker reacting to it. An entry
 * is never changed: a card edited twice has two entries, and none of them collides
 * with another, nor with the card. Each one takes its event's id, so a job that runs
 * twice records it once.
 */
export class Activity_Module extends Module {

  static initialize(base: BoardsBase, deps: Activity_Deps, options: Activity_Options): Activity_Module {
    const module = new Activity_Module(base, new Activity_Repository(base), deps)
    registerActivityRoutes(base, module, deps)
    registerActivityWorkers(module, deps, options)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Activity_Repository, deps: Activity_Deps) {
    super('activity', base.invocations, deps)
  }

  /** A page of a card's activity, the newest first. Its card may be gone: its history stays. */
  @UseCase()
  async listForCard(cardId: string, page: PageRequest): Promise<Page<ActivityDTO>> {
    const found = await this.repo.page({ cardId }, page, { newestFirst: true })
    return mapPage(found, entry => entry.toDTO())
  }

  @UseCase()
  async recordCreated(card: Card_Created['payload'], event: EventMeta): Promise<void> {
    await this.append(card, card, event, 'created', { number: card.number, title: card.title, columnId: card.columnId })
  }

  @UseCase()
  async recordEdited({ dto, changes, ...origin }: Card_Edited['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'edited', { changed: Object.keys(changes).filter(field => field !== 'updatedAt').join(', '), title: dto.title })
  }

  @UseCase()
  async recordMoved({ dto, previous, ...origin }: Card_Moved['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'moved', { fromColumnId: previous.columnId ?? dto.columnId, toColumnId: dto.columnId })
  }

  @UseCase()
  async recordAssigned({ dto, previousAssigneeId, ...origin }: Card_Assigned['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'assigned', { assigneeId: dto.assigneeId, previousAssigneeId })
  }

  @UseCase()
  async recordUnassigned({ dto, previousAssigneeId, ...origin }: Card_Unassigned['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'unassigned', { previousAssigneeId })
  }

  @UseCase()
  async recordDeleted(card: Card_Deleted['payload'], event: EventMeta): Promise<void> {
    await this.append(card, card, event, 'deleted', { number: card.number, title: card.title })
  }

  /**
   * Records an event of a card, in its workspace (a worker is in none), by the event's
   * id: the second time, the entry is there already.
   */
  private async append(card: CardDTO, { by, via }: CardAuthor, event: EventMeta, kind: ActivityKind, detail: ActivityDTO['detail']): Promise<void> {
    await runInWorkspace(card.workspaceId, async () => {
      if (await this.repo.first({ id: event.id })) return
      await this.repo.persist(Activity.record({
        id: event.id,
        workspaceId: card.workspaceId,
        boardId: card.boardId,
        cardId: card.id,
        kind,
        actorId: by,
        via,
        at: event.occurredAt,
        detail,
      }))
    })
  }
}
```

### The event's id: `EventMeta`

Each `record…` use case takes two things: the event's payload, typed by the event's
class (`Card_Moved['payload']`), and **`EventMeta`**, from `newt/core`: what else is
known of the event, its `id`, its `name` and when it happened, `occurredAt`.

The id is the publisher's: newt gives every event one as it is told. It is the **same
for every handler of the event and every run of its job**. Two runs of
`activity.recordMoved` for one move see one id; the history's job and the email's job
(next chapter) see the same id too. A move made again later is another event, with
another id.

That makes it the natural **idempotency key**: whatever a handler must do once per
event, it does keyed on the event's id. The activity takes it as each entry's own id,
and `append` checks before it writes:

- `this.repo.first({ id: event.id })`: if the entry is there, a run before this one
  recorded it, and there is nothing to do.
- If it is not, it writes the entry with that id. Should two runs pass the check at
  once (a worker that lost its lease, and the one that took it over), the second
  insert collides with the first on the primary key: the save throws
  `DuplicateValue`, the use case runs again, finds the entry, and returns. The table
  never holds two.

A handler that keys on the payload instead (the card's id and the kind, say) would
merge two real moves into one. The event's id tells one telling of an event from
another, and nothing else does.

`at` is the event's `occurredAt`, not the time the job ran: a job that runs a minute
late still records when it happened.

### A worker has no scope

`append` runs in `runInWorkspace(card.workspaceId, …)`. The activity repository is
scoped to a workspace and would refuse to read or write outside one, and a job runs in
none. The payload says the workspace; `runInWorkspace` enters it without checking
anyone, as chapter [4](./04-who-and-where) made it for workers and scripts that
already know.

Who did it comes from the payload as well, `by` and `via`, which is why chapter
[10](./10-events) put them there.

### The payload's types

The module imports the card events' classes with `import type`, for their payload
types only, and `CardAuthor` and `CardDTO` from the card's schema. A module may reach
another's events and schema (`newt/module-boundaries` allows it); it never reaches its
repository or its entity.

### Reading

`listForCard` is a plain page (chapter [3](./03-pages-and-errors)), newest first. It
reads by the card's id only, never through the card module: the card may be deleted,
and its history stays.

## Subscribing: `handler`

Each card event gets its handler, next to the log line of chapter
[10](./10-events). The whole `activity.workers.ts`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.workers.ts
import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'
import type { Activity_Options } from './activity-options'

/**
 * What the activity does when something happens to a card: each event a `handler`,
 * a job saved with the change, so no entry is ever missing, run until it succeeds
 * and safe to run again (keyed on the event's id).
 */
export function registerActivityWorkers(activity: Activity_Module, deps: Activity_Deps, options: Activity_Options): void {
  const { events } = deps.card
  events.created.subscribe((card, event) => activity.recordCreated(card, event), { strategy: 'handler', queue: 'activity.recordCreated.on.card.created' })
  events.edited.subscribe((edit, event) => activity.recordEdited(edit, event), { strategy: 'handler', queue: 'activity.recordEdited.on.card.edited' })
  events.moved.subscribe((move, event) => activity.recordMoved(move, event), { strategy: 'handler', queue: 'activity.recordMoved.on.card.moved' })
  events.assigned.subscribe((assignment, event) => activity.recordAssigned(assignment, event), { strategy: 'handler', queue: 'activity.recordAssigned.on.card.assigned' })
  events.unassigned.subscribe((unassignment, event) => activity.recordUnassigned(unassignment, event), { strategy: 'handler', queue: 'activity.recordUnassigned.on.card.unassigned' })
  events.deleted.subscribe((card, event) => activity.recordDeleted(card, event), { strategy: 'handler', queue: 'activity.recordDeleted.on.card.deleted' })

  // A line in the server's log as each card moves, to watch a board live while
  // tracing. `fire-and-forget`: in memory, after the commit, with no job. If it fails,
  // or the server stops before it runs, the line is lost, and nothing is wrong: no
  // one needs it later, and the log above keeps the move for good.
  events.moved.subscribe(({ dto, previous, by, via }) => {
    options.log(`[boards] #${dto.number} "${dto.title}" moved from column ${previous.columnId} to ${dto.columnId} by ${by ?? 'cooper'}${via ? ` (${via})` : ''}`)
  }, { strategy: 'fire-and-forget' })
}
```

The callback takes a second argument now, the `EventMeta`, and calls one use case of
the module that reacts with what it needs. It does nothing else: the logic lives in
the use case, where it can be tested and traced.

`strategy: 'handler'` takes the queue's name, `queue`, and nothing else is needed.
The comment at the top of the file now says what the handlers give, and the log
line's comment says why losing a line is fine: the log above keeps the move for good.

### The queue's name

The jobs of each handler wait in their queue, and the queue's name is how the worker
finds the handler again after a restart: a job written yesterday names its queue, and
today's process runs whatever handler subscribed under that name. So you write it
whole, always in the same shape:

```text
<module that reacts>.<use case it calls>.on.<module that tells>.<event>

activity.recordMoved.on.card.moved
```

Read aloud, it says what it does: "the activity records the move on `card.moved`".
Two reactions of the same module to the same event call two use cases, so they are two
queues; one use case reacting to two events is two queues too.

newt checks the end when the context opens: a queue that does not end with the event
it is subscribed to throws, and the context does not start. Subscribe
`events.deleted` with `activity.recordDeleted.on.card.removed`, and every test fails
with:

```text
A handler's queue is '<module>.<use case>.on.card.deleted': 'activity.recordDeleted.on.card.removed' is not
```

The lint checks the rest, before anything runs. **`newt/queue-name`** reads each
`subscribe` in a module's files: the queue starts with the module whose file it is in,
names the use case its callback calls on that module, and ends with the event it is
subscribed under. Name the move's queue `activity.recordMove.on.card.moved` (one
letter short), and `bun run lint` says:

```text
error  This queue says the handler calls activity's 'recordMove', but its callback calls no 'recordMove' of activity: name the use case it calls  newt/queue-name
```

and for the wrong event:

```text
error  This queue ends with '.on.….deleted', the event it subscribes to  newt/queue-name
```

**Renaming a queue** is not free. Its pending jobs stay under the old name, which no
handler serves any more. newt does not let that pass in silence: the worker notes the
queues it serves, and warns once about a queue with jobs waiting that no worker has
served for five minutes. Rename a handler, its use case or its module when its queue
is empty, or move its pending jobs with a migration.

## The route

A card's activity is read under the workspace, like everything of boards:
`GET /workspaces/:workspaceId/cards/:cardId/activity`. Its routes need the member
module, as every module's do. Add it to the deps:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.deps.ts
import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
  /** That who reads a card's activity belongs to its workspace (its routes). */
  member: Member_Module
}
```

```ts
// cooper/backend/contexts/boards/modules/activity/activity.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'

export function registerActivityRoutes(base: BoardsBase, activity: Activity_Module, deps: Activity_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/cards/:cardId/activity', async request =>
    Response.json(await activity.listForCard(request.params.cardId, pageRequestFrom(request))))
}
```

and pass it in `initialize-modules.ts`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
  const activity = Activity_Module.initialize(base, { card, member }, { log: deps.log ?? (() => {}) })
```

## Waiting for the worker in a test

A job runs after the commit, on the worker's time. A test that creates a card and
reads its activity at once would read nothing. It must wait until the worker is done.

`base.jobs.idle()` resolves once no job is ready nor running: it runs what is due,
waits for what is in progress, and does it again until there is nothing left. Give the
test helper a method for it, `settled`, after `as`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
    /** Until the background work is done: what boards' events made it do. */
    async settled(): Promise<void> {
      await boards.base.jobs.idle()
    },
```

A test calls `await t.settled()` after doing things and before looking at what their
reactions did. A job that waits to run again later (the next chapter's backoff) is not
due, and `idle` does not wait for it.

## Tests

Add three tests to `activity.test.ts`, before the one of chapter
[10](./10-events), with a helper that reads a card's activity:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
  const inAcme = <T>(fn: () => Promise<T>, via: 'web' | 'mcp' = 'web') => t.as('ana', 'acme', fn, via)
  const activityOf = (cardId: string, size = 20) => inAcme(() => t.modules.activity.listForCard(cardId, { size }))

  test('records what happens to a card, who did it and how they came in, the newest first', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await inAcme(() => t.modules.card.edit(card.id, { title: 'Plan it' }))
    await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')
    await inAcme(() => t.modules.card.assign(card.id, { assigneeId: 'bea' }))
    await inAcme(() => t.modules.card.unassign(card.id))
    await inAcme(() => t.modules.card.delete(card.id))
    await t.settled()

    const { items, total } = await activityOf(card.id)
    expect(total).toBe(6)
    expect(items.map(entry => [entry.kind, entry.actorId, entry.via])).toEqual([
      ['deleted', 'ana', 'web'],
      ['unassigned', 'ana', 'web'],
      ['assigned', 'ana', 'web'],
      ['moved', 'ana', 'mcp'],
      ['edited', 'ana', 'web'],
      ['created', 'ana', 'web'],
    ])
    expect(items.find(entry => entry.kind === 'moved')!.detail).toEqual({ fromColumnId: todo, toColumnId: doing })
    expect(items.find(entry => entry.kind === 'edited')!.detail).toMatchObject({ changed: 'title', title: 'Plan it' })
    expect(items.find(entry => entry.kind === 'assigned')!.detail).toEqual({ assigneeId: 'bea', previousAssigneeId: null })

    // Page after page, by the cursor.
    const first = await activityOf(card.id, 4)
    const rest = await inAcme(() => t.modules.activity.listForCard(card.id, { size: 4, cursor: first.items.at(-1)!.id }))
    expect([...first.items, ...rest.items].map(entry => entry.kind)).toEqual(items.map(entry => entry.kind))
    expect(rest.hasMore).toBe(false)
  })

  test('records each event once, however many times its job runs', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await t.settled()
    const told = { ...card, by: 'ana', via: 'web' as const }
    const event = { id: Bun.randomUUIDv7(), name: 'card.created', occurredAt: new Date().toISOString() }

    await t.modules.activity.recordCreated(told, event)
    await t.modules.activity.recordCreated(told, event)

    expect((await activityOf(card.id)).total).toBe(2)
  })

  test('shows a workspace\'s activity only in it', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await t.settled()

    expect((await t.as('carl', 'globex', () => t.modules.activity.listForCard(card.id, { size: 20 }))).total).toBe(0)
  })
```

- The first does everything a card goes through, waits for the worker, and reads the
  six entries, newest first, by pages too. The card is deleted by then: its history
  stays.
- The second is a job that runs twice. It calls `recordCreated` twice with the same
  event, as the worker would on a second run, and the card has two entries: the
  `card.created` the worker recorded, and this event's, once. Calling the use case
  directly, outside any actor and any workspace, is how a worker calls it.
- The third reads the card's activity from globex, and finds none: the repository's
  scope.

The first test also shows `settled()` at work: without it, the test would read the
activity while the worker may still be writing it.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

Then by hand. Start the backend (`bun cooper/backend/index.ts`): it runs migration
00005 as it opens. Make a card and move it, as in chapter [10](./10-events), then read
its activity:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
post() { curl -s -X POST "$API$1" -H "$H" -H 'x-user: ana' -d "$2"; }
BOARD=$(post /boards "{\"name\":\"History $RANDOM\"}" | jq -r .id)
TODO=$(post /boards/$BOARD/columns '{"name":"To do"}' | jq -r .id)
DOING=$(post /boards/$BOARD/columns '{"name":"Doing"}' | jq -r .id)
CARD=$(post /boards/$BOARD/cards "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" | jq -r .id)
post /cards/$CARD/move "{\"columnId\":\"$DOING\"}" > /dev/null
curl -s $API/cards/$CARD/activity -H 'x-user: ana' | jq -c '.items[] | {kind, actorId, via, detail}'
```

```text
{"kind":"moved","actorId":"ana","via":"web","detail":{"fromColumnId":"01a17957-8995-71de-978e-f65c646f7700","toColumnId":"01a17957-899d-741b-b50a-c2dafd47c482"}}
{"kind":"created","actorId":"ana","via":"web","detail":{"number":1,"title":"Plan","columnId":"01a17957-8995-71de-978e-f65c646f7700"}}
```

The console still shows the move's line, as before. And the outbox keeps the jobs
that wrote the entries. Look at them in the database:

```sh
sqlite3 data/cooper-boards.db "SELECT queue, status, attempts FROM job ORDER BY created_at, queue"
```

```text
activity.recordCreated.on.card.created|done|1
activity.recordMoved.on.card.moved|done|1
```

Each one done at its first attempt, one per event. (Cards changed before this chapter
left no jobs: nothing subscribed as a handler then. Any you change now add theirs.)
Jobs done are history: newt purges them after a week.

## What to remember

- `strategy: 'handler'` writes a job in the outbox, in the transaction of the change
  that tells the event: both are stored or neither is. The context's worker runs it
  after the commit, and again until it succeeds.
- Its `queue` is `<module>.<use case>.on.<module>.<event>`. newt refuses one that does
  not end with its event; `newt/queue-name` checks the rest. Renaming it leaves its
  pending jobs behind.
- A job runs at least once, so maybe more: what it does must be idempotent. The
  handler's second argument, `EventMeta`, gives the event's `id`, the same for every
  run: key on it.
- A job runs with no actor and no scope: it reads who did it from the payload, and
  enters the workspace itself (`runInWorkspace`).
- A test waits for the worker with `base.jobs.idle()` before looking at what reactions
  did.

Next: [What cannot be undone, and failures](./12-failures).
