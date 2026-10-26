# What cannot be undone, and failures

Ana assigns card #1 to carl. carl should hear of it: an email, "#1 Plan is yours",
with a link to the card.

Where does the email leave from? The obvious place is `card.assign`, right after the
save. It is the wrong one. Chapter [8](./08-two-people-one-card) said why: a use case
may run again on a conflict, from the start, and one that sent an email before saving
would send it twice. After the save is no safer: a use case called by another runs
again whenever its caller collides, and sends again each time; and a use case that
fails after its save has told carl of something its caller may never show. A database
write can be rolled back. **An email cannot be taken back.**

The answer is the [previous chapter](./11-reacting)'s: a `handler` on `card.assigned`.
Its job is saved with the assignment, so the email leaves only for an assignment that
was saved, once it was saved. This chapter writes it, with a mailer the application
hands in, and then looks at what happens when a job keeps failing: the mail server is
down, the job runs out of attempts, and someone has to put it back.

## The mailer: a port of the application

The card module should not know how an email is sent: SMTP, an email API, the
console. It needs one thing, "send this email", in its own words. That is a port,
like the `Workspaces` port of chapter [4](./04-who-and-where). But this one is not
boards' alone: auth sends emails too, later. So it lives in `shared/`, as the
application's:

```ts
// cooper/backend/shared/mail/mailer.ts
import type { Email } from 'newt/core'

/** One email: plain text, which every reader shows. */
export type Mail = {
  to: Email
  subject: string
  text: string
  /**
   * The same email sent again has the same key, and is sent once: what a worker gives
   * when its job may run twice (the id of the event it tells of). A mailer of a real
   * provider must honour it, passing it as the provider's idempotency key (most take
   * one, as a header). None: each send is a new email.
   */
  key?: string
}

/**
 * Whatever sends an email: the console in development, a list in a test, an SMTP
 * server or an email API in production. A module sends one only from a worker, once
 * what it tells is saved: an email cannot be taken back. An email with a `key`
 * already sent is not sent again.
 */
export type Mailer = {
  send(mail: Mail): Promise<void>
}
```

- `Mail` is plain text, which every reader shows. `to` is newt's `Email` (trimmed, in
  lower case), the type a member's email already has.
- `key` is optional. Two emails with the same key are one email: the second is not
  sent. Why a worker needs that is the subject of [Run twice, sent
  once](#run-twice-sent-once), below.
- `Mailer` is a type with one method. Whatever has it is a mailer.

Its comment says the rule that comes with it: a module sends an email only from a
worker, once what it tells is saved. And the promise every mailer makes: an email
whose key was already sent is not sent again.

The first adapter writes each email to the console, for development:

```ts
// cooper/backend/shared/mail/console-mailer.ts
import type { Mail, Mailer } from './mailer'

/**
 * A mailer that writes each email to the console instead of sending it: cooper's, in
 * development. It remembers the keys it wrote while the process runs: an email with
 * one of them is not written again.
 */
export class ConsoleMailer implements Mailer {

  private readonly sent = new Set<string>()

  constructor(private readonly from: string) {}

  async send(mail: Mail): Promise<void> {
    if (mail.key !== undefined) {
      if (this.sent.has(mail.key)) return
      this.sent.add(mail.key)
    }
    console.log([`[mail] from ${this.from} to ${mail.to}: ${mail.subject}`, ...mail.text.split('\n').map(line => `  ${line}`)].join('\n'))
  }
}
```

It keeps its promise the simplest way: a set of the keys it wrote, in memory. That is
enough for development, where a restart forgets them and nobody minds. A test gets
another one, a list (below). Production gets one that talks to a real mail service and
hands it the key; the module does not change.

## Where to write to: the member's email

To send carl an email the card module needs carl's address and name. boards does not
keep people: auth does, and boards asks through the `Workspaces` port. It can only
answer whether someone is a member. Add a method that gives the member, after
`isMember`:

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
import type { MemberDTO } from './member.schema'
// …
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
}
```

`MemberDTO` has been in `member.schema.ts` since chapter [4](./04-who-and-where): an
id, a name and an email. The fake auth answers it from what it keeps:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
    member: async (workspaceId, userId) => this.members.get(workspaceId)?.get(userId) ?? null,
```

The member module offers it as a use case, `find`, after `isMember`. Import
`MemberDTO` too:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
import type { MemberDTO } from './member.schema'
// …
  /** Someone of a workspace, or null if they do not belong to it (any more): what a worker, outside any scope, asks. */
  @UseCase()
  async find(workspaceId: string, userId: string): Promise<MemberDTO | null> {
    return this.deps.workspaces.member(workspaceId, userId)
  }
```

`isMember` reads the workspace from the scope; `find` takes it as an argument. One is
for requests, which entered a workspace; the other for workers, which are in none.

The card module's deps say what it now asks the member module:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
```

## The cards' options

The card module takes the mailer at `initialize`, as an option, and where people open
boards, for the email's link:

```ts
// cooper/backend/contexts/boards/modules/card/card-options.ts
import type { Mailer } from '../../../../shared/mail/mailer'

/** What the context configures the cards with. */
export type Card_Options = {
  /** What tells an assignee: the console in development, a list in a test. */
  mailer: Mailer
  /** Where people open boards: the links of its emails start there. */
  publicUrl: string
}
```

Both come from the context. `publicUrl` is a setting, so it goes in `config.ts`, with
who the emails come from. Here is the whole file now:

```ts
// cooper/backend/config.ts
import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

const env = process.env

/**
 * `COOPER_<CONTEXT>_PUBLIC_URL`: where people open each context. In development it is
 * its frontend's Vite server, which sends the API's addresses on to the context's port;
 * in production, the context's own domain, in front of its port.
 */
const publicUrls = {
  boards: env.COOPER_BOARDS_PUBLIC_URL ?? 'http://localhost:5172',
}

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens, where its database lives and
 * where people open it.
 */
export const config = {
  /** `COOPER_MAIL_FROM`: who the emails come from, whichever context sends them. */
  mail: {
    from: env.COOPER_MAIL_FROM ?? 'cooper <no-reply@cooper.local>',
  },
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
    publicUrl: publicUrls.boards,
  },
}

export type Config = typeof config
```

- `COOPER_MAIL_FROM` is one for the whole application: every context's emails come
  from the same address.
- `COOPER_BOARDS_PUBLIC_URL` is where people open boards. In development, boards'
  frontend (chapter [23](./23-frontends)) runs on port 5172; in production, boards'
  own domain. A link in an email is sent once and cannot be fixed afterwards, so it
  is built from this setting, never from where a request came in.

`Boards_Config` is `Config['boards']`, so the context gets `publicUrl` with no other
change.

The mailer is not a setting: it is something the context is handed, like the
`Workspaces` port. In `initialize-modules.ts` it joins `Boards_ModuleDeps`, and the
cards get their options. The file also initializes the outbox module, which comes
below; here it is whole:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace), and a mailer. Whoever opens the
 * context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  mailer: Mailer
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  const activity = Activity_Module.initialize(base, { card, member }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { member, board, column, card, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

## The use case that sends it

In `card.module.ts`, `initialize` takes the options, keeps them, and registers the
module's reactions (the next section's file):

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  static initialize(base: BoardsBase, deps: Card_Deps, options: Card_Options): Card_Module {
    const module = new Card_Module(base, new Card_Repository(base), deps, options)
    registerCardRoutes(base, module, deps)
    registerCardWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(
    base: BoardsBase,
    private readonly repo: Card_Repository,
    private readonly deps: Card_Deps,
    private readonly options: Card_Options,
  ) {
```

with three more imports:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
// …
import type { Card_Deps } from './card.deps'
import type { Card_Options } from './card-options'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { registerCardWorkers } from './card.workers'
```

And the use case a worker calls, after `removeColumn`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Tells the assignee of a card they have it, by email: from a worker, once the
   * assignment is saved, since an email cannot be taken back. Run late, it
   * reads the card again: if it is gone, or has another assignee by then, there is
   * nothing to tell (that assignment tells its own). Nor is anyone told of a card
   * they gave themselves (`by`, who created or assigned it). Its job may run twice:
   * the email's key is the event's id (`eventId`), so it is sent once.
   */
  @UseCase()
  async notifyAssignee(card: CardDTO, by: string | null, eventId: string): Promise<void> {
    if (card.assigneeId === null || card.assigneeId === by) return
    const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
    if (current?.assigneeId !== card.assigneeId) return
    const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
    if (!member) return
    // Where boards' UI opens the card: on its board's screen, by its id.
    const link = new URL(`/w/${card.workspaceId}/boards/${card.boardId}?card=${card.id}`, this.options.publicUrl)
    await this.options.mailer.send({
      to: member.email,
      subject: `#${card.number} ${card.title} is yours`,
      text: [`Hi ${member.name},`, '', `Card #${card.number}, "${card.title}", is assigned to you.`, '', link.toString()].join('\n'),
      key: `card.notifyAssignee:${eventId}`,
    })
  }
```

Read it as the list of reasons **not** to send:

1. **Nobody to tell, or they did it themselves.** A card with no assignee, or one ana
   gave herself: `by` is who acted, from the event, since a worker has no actor.
2. **It is no longer true.** A job runs a moment after its save, or minutes later, if
   it failed before. By then the card may be deleted, or assigned to someone else. So
   it **reads the card again**, in its workspace, and sends nothing if the assignee
   is not the one the event told. If ana gave the card to bea and took it back a
   second later, bea hears nothing; if she gave it to carl instead, carl's own
   `card.assigned` tells him.
3. **They left.** The member is not in the workspace any more: `find` says null.

Only then does it build the link and send, with a key. The use case `assign` knows
nothing about email; this one knows nothing about assigning.

### Run twice, sent once

The [previous chapter](./11-reacting) made every handler idempotent, keyed on its
event's id. An email is the case where cooper's database cannot do it alone. If the
process stops after the mailer sent and before the job is marked done, the job runs
again, from the start: it reads the card, finds carl still its assignee, and sends.
The same happens if the job fails on anything after the send, or if its worker loses
its lease mid-send. Nothing cooper writes can prevent it: the send is outside its
database, and no transaction spans both.

So the far side has to help. The job of one event is the same job each time it runs,
and its event has the same id each time: that id is the email's **key**,
`card.notifyAssignee:<event id>`. The first run sends the email under that key; a
second run sends it again under the same key, and the mailer drops it. Another
assignment is another event, another id, another email: if the card goes to carl,
then to bea, then to carl again, carl hears of it twice, as he should.

That moves the guarantee to the mailer, and every mailer has to keep it:

- `ConsoleMailer` and the tests' mailer remember the keys they have seen.
- A real provider's mailer passes the key on as the provider's **idempotency key**.
  Most email APIs take one, as a header, and send one email per key, however many
  requests carry it. A mailer that drops the key would let the duplicate through, and
  nothing in boards would notice.

The prefix, `card.notifyAssignee:`, keeps keys of different reactions apart: another
worker on the same event, sending another email, gives its own name. And reading
the card again still matters: the key stops the same email twice, not an email that is
no longer true.

## The reaction, and `when`

The card module reacts to its own events. A module's reactions go in
`<module>.workers.ts`, as the activity's did:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

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
}
```

Two queues for one use case: an assignee hears of a card **created** for them, and of
one **assigned** to them. Each is its own queue, named after the event it hears.

A handler gets a second argument besides the payload: the event's `EventMeta`
(chapter [11](./11-reacting)). Its `id` is the event's, the same on every run of the
job, and it becomes `notifyAssignee`'s `eventId`, the email's key.

`registerCardWorkers` takes the module's deps and does not use them yet: chapter
[13](./13-another-context) adds reactions to the columns' events and to auth's.

`card.created` comes with **`when`**. Most cards are created with nobody assigned, and
those need no email. `when` looks at the payload and says whether this subscription
takes the event at all:

- It runs in the transaction of the save that tells the event, **before any job is
  written**. A card created with no assignee leaves no job in
  `card.notifyAssignee.on.card.created`: nothing to claim, nothing to run, nothing to
  purge.
- It only looks at the payload. It is not business logic: whether the assignee should
  hear is `notifyAssignee`'s to say. `when` says which events concern the reaction
  at all.
- With a type guard, its parameter typed, it narrows what the callback gets. Chapter
  [13](./13-another-context) uses that.

`card.assigned` has no `when`: an assignment always has an assignee.

## When a job fails

A handler that throws has failed, and newt runs its job again. Not at once: the mail
server that was down a second ago is probably still down. Each run is an **attempt**,
and after each failed one the job waits, twice as long each time, the **backoff**:

| After attempt | It waits |
|---|---|
| 1 | 10 seconds |
| 2 | 20 seconds |
| 3 | 40 seconds |
| 4 | 80 seconds |
| … | doubling, up to 15 minutes |

A subscription has **5 attempts** unless it says otherwise, with `attempts`. With the
default, a job that always fails runs five times over about two and a half minutes. A
job that must outlast a longer outage asks for more: chapter [14](./14-sagas) gives
one ten.

The waits are the context's: `Base` takes `jobs: { backoffMs, maxBackoffMs }` (10
seconds and 15 minutes by default), with the worker's other settings. cooper keeps
newt's defaults.

While a job runs it belongs to its worker for a lease of a minute, which the worker
renews as long as the handler runs. A worker that dies mid-job (the process killed)
stops renewing, and a minute later another worker, or the same server once it is
back, takes the job. That claim counts as an attempt too: a job whose worker died on
every attempt is not run again.

### Dead jobs

A job that runs out of attempts is **dead**. newt keeps it with its last error and
stops running it. Nothing else happens on its own: an email that was never sent, a
step of a flow that never ran. **Someone has to look**: find what killed it, fix it,
and put the job back.

The store gives what that takes. Each store keeps its jobs in its own **`Outbox`**,
newt's port for them (`newt/port-outbox`), at `base.store.outbox`. Three of its methods
are for whoever looks after the jobs:

- `list(query?)`: the jobs it keeps, oldest first; `{ status: 'dead' }` for the dead
  ones.
- `get(id)`: one job.
- `retry(id)`: puts a dead job back to wait, as new: no attempts, due now. It says
  whether it did: a job in any other state is left as it is.

Each job says its `queue`, its `status` (`pending`, `running`, `done` or `dead`), its
`attempts`, its `lastError`, and its `event`, as the JSON it was told with.

### An outbox module for each context

No module reaches into the store: modules use repositories, and a context's store is
its own. So cooper puts one small module over each context's outbox, shared by every
context: each initializes its own, over its own store. It has two errors:

```ts
// cooper/backend/shared/outbox/errors/job-not-found.ts
import { NotFoundError } from 'newt/core'

export class JobNotFound extends NotFoundError {
  readonly code = 'outbox.job_not_found'
  constructor(id: string) {
    super(`There is no job ${id}`)
  }
}
```

```ts
// cooper/backend/shared/outbox/errors/job-not-dead.ts
import { ConflictError } from 'newt/core'

/** Only a dead job is retried: one waiting or running is on its way, one done is done. */
export class JobNotDead extends ConflictError {
  readonly code = 'outbox.job_not_dead'
  constructor(id: string, status: string) {
    super(`Job ${id} is ${status}, not dead: only a dead job is retried`)
  }
}
```

what it shows of a dead job:

```ts
// cooper/backend/shared/outbox/outbox.schema.ts
/**
 * A job that ran out of attempts, as whoever looks after a context's jobs sees it: the
 * reaction it was (`queue`), to which event, how many times it ran and why it failed
 * the last time. Its event's payload stays out: it may say more than the staff need.
 */
export type DeadJobDTO = {
  id: string
  queue: string
  /** The event's name: `card.assigned`. */
  event: string
  attempts: number
  lastError: string | null
  createdAt: string
  /** When it died. */
  updatedAt: string
}
```

and the module:

```ts
// cooper/backend/shared/outbox/outbox.module.ts
import { Module, toPage, UseCase, type Page, type PageRequest } from 'newt/core'
import type { Job } from 'newt/port-outbox'
import type { CooperBase } from '../cooper-base'
import { JobNotDead } from './errors/job-not-dead'
import { JobNotFound } from './errors/job-not-found'
import type { DeadJobDTO } from './outbox.schema'

/** The event's name, from the job's copy of it. */
function eventName(job: Job): string {
  try {
    return String((JSON.parse(job.event) as { name?: unknown }).name ?? '')
  } catch {
    return ''
  }
}

function toDTO(job: Job): DeadJobDTO {
  const { id, queue, attempts, lastError, createdAt, updatedAt } = job
  return { id, queue, event: eventName(job), attempts, lastError, createdAt, updatedAt }
}

/**
 * A context's own jobs, for whoever looks after them: those that ran out of
 * attempts, and putting one back to run once what killed it is fixed. Each context
 * initializes one over its own store's outbox, and the staff's backoffice reaches
 * them through these use cases, never through another context's base or store.
 *
 * It has no routes: the backoffice's are the only ones, and they check who asks.
 */
export class Outbox_Module extends Module {

  static initialize(base: CooperBase): Outbox_Module {
    return new Outbox_Module(base)
  }

  private constructor(private readonly base: CooperBase) {
    super('outbox', base.invocations)
  }

  /**
   * A page of its dead jobs, the newest first (by id: one made later has a greater
   * one): they wait for someone, and are few, so they are all read, and the page is
   * cut here, its cursor still good once the job it names was retried.
   */
  @UseCase()
  async dead(page: PageRequest): Promise<Page<DeadJobDTO>> {
    const dead = (await this.base.store.outbox.list({ status: 'dead' })).toSorted((a, b) => (a.id < b.id ? 1 : -1))
    const after = page.cursor ? dead.filter(job => job.id < page.cursor!) : dead
    return toPage(after.slice(0, page.size + 1).map(toDTO), page.size, dead.length)
  }

  /**
   * Puts a dead job back to wait, as new: its worker runs it again at once, with all its
   * attempts. A plain use case: it writes no module's rows through a repository, which
   * is what the write rule watches, but the store's outbox, in one step.
   */
  @UseCase()
  async retry(id: string): Promise<void> {
    if (await this.base.store.outbox.retry(id)) return
    const job = await this.base.store.outbox.get(id)
    throw job ? new JobNotDead(id, job.status) : new JobNotFound(id)
  }
}
```

- `dead(page)` lists the dead jobs, newest first, a page at a time. They wait for
  someone and are few, so it reads them all and cuts the page itself, with `toPage`
  from `newt/core`.
- `retry(id)` puts one back. If it was not dead, it says why: not found (404), or
  pending, running or done (409). A job done is done: retrying it would do it twice.
- A dead job leaves its event's payload out. The staff see which reaction failed, on
  which event, how many times and why; the payload may say more than they need.
- It has no routes. The staff's backoffice (chapter [26](./26-dead-jobs-and-analytics))
  lists and retries every context's dead jobs through these two use cases, behind
  its own check of who asks.

`retry` writes to the store's outbox, not to any module's rows, so the write rule of
chapter [8](./08-two-people-one-card) has nothing to say about it: a request may call
it.

You saw it initialized above, last in `initializeModules`: `boards.modules.outbox`.

## Wiring the mailer

A test keeps its emails in a list. Its mailer keeps a promise too: an email whose key
it already kept is not kept again, as a provider would send it once. It is the
application's, shared by every context's tests, so it lives next to the port:

```ts
// cooper/backend/shared/mail/recording-mailer.ts
import type { Mail, Mailer } from './mailer'

/**
 * A mailer that keeps each email in a list instead of sending it: a test's. An email
 * with a key already kept is not kept again, as a provider sends it once.
 */
export class RecordingMailer implements Mailer {

  readonly mails: Mail[] = []

  async send(mail: Mail): Promise<void> {
    if (mail.key !== undefined && this.mails.some(each => each.key === mail.key)) return
    this.mails.push(mail)
  }
}
```

A test reads its `mails`, as it reads the log's lines. The whole
`open-test-boards.ts`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { RecordingMailer } from '../../../shared/mail/recording-mailer'
import { Boards_Context } from '../boards.context'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, its emails
 * and its log's lines in lists, and who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mailer = new RecordingMailer()
  const lines: string[] = []
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    mailer,
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    mails: mailer.mails,
    lines,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    /** Until the background work is done: what boards' events made it do. */
    async settled(): Promise<void> {
      await boards.base.jobs.idle()
    },
    async close(): Promise<void> {
      await boards.stop()
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

`t.mails` is the recording mailer's list: what reached the far side, a duplicate
dropped as a provider drops it.

The backend hands the context a `ConsoleMailer`. To assign a card to someone else in
acme there must be someone else, so carl joins it. Here is the whole `index.ts`:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'
import { FakeAuth } from './contexts/boards/testing/fake-auth'
import { ConsoleMailer } from './shared/mail/console-mailer'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()

// For now auth is a fake one, in memory: ana and carl are in acme, bea in globex (chapter 17 brings the real one).
const auth = await FakeAuth.open()
auth.join('acme', 'ana')
auth.join('acme', 'carl')
auth.join('globex', 'bea')

// For now each card's move is a line on the console (chapter 28 writes it only while tracing).
const boards = await Boards_Context.open(config.boards, {
  workspaces: auth.workspaces,
  mailer: new ConsoleMailer(config.mail.from),
  log: line => console.log(line),
})
// For now, who sends a request says who they are in an `x-user` header (chapter 22 signs them in).
boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId, via: 'web' as const } : null
})
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
```

## Tests

In `card.test.ts`, chapter [7](./07-cards-and-a-counter)'s test that assigns a card
only to a member becomes one that also checks the email, and four tests follow it, at
the end of the file:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('assigns a card only to a member of its workspace, and tells them by email once saved', async () => {
    const plan = await create('Plan')

    await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })

    await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    expect(t.mails).toEqual([])
    await t.settled()
    expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#1 Plan is yours']])
    // The link opens the card on its board, in boards' UI.
    expect(t.mails[0]!.text).toBe(['Hi bea,', '', 'Card #1, "Plan", is assigned to you.', '', new URL(`/w/acme/boards/${boardId}?card=${plan.id}`, t.boards.config.publicUrl).toString()].join('\n'))

    // Assigning it again to the same one changes nothing, and tells nothing.
    await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await t.settled()
    expect(t.mails).toHaveLength(1)
  })

  test('tells the assignee once, however many times the job of an assignment runs', async () => {
    const { id } = await create('Plan')
    const plan = await inAcme(() => t.modules.card.assign(id, { assigneeId: 'bea' }))

    // The job of one event, run twice (its first run failed after sending), and one of another event.
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-1')
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-1')
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-2')

    expect(t.mails.map(mail => [mail.subject, mail.key])).toEqual([['#1 Plan is yours', 'card.notifyAssignee:event-1'], ['#1 Plan is yours', 'card.notifyAssignee:event-2']])
  })

  test('tells the assignee of a card created for them, and nobody of one assigned and unassigned at once', async () => {
    await create('Plan', { assigneeId: 'bea' })
    const design = await create('Design')
    // To someone else than who gives it, who would hear of it but for the card read again.
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'bea' }))
    await inAcme(() => t.modules.card.unassign(design.id))

    await t.settled()

    expect(t.mails.map(mail => mail.subject)).toEqual(['#1 Plan is yours'])
  })

  test('tells nobody of a card they created for themselves, or took', async () => {
    await create('Plan', { assigneeId: 'ana' })
    const design = await create('Design')
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'ana' }))
    // Given to someone else, they hear of it.
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'bea' }))

    await t.settled()

    expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#2 Design is yours']])
  })

  test('a reaction that keeps failing dies after its attempts, is listed, and runs once retried', async () => {
    // A reaction of the test's own, as if the mail server were down, at its only attempt.
    let down = true
    t.modules.card.events.created.subscribe(() => {
      if (down) throw new Error('the mail server is down')
    // eslint-disable-next-line newt/queue-name
    }, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
    await create('Plan')
    await t.settled()

    const dead = await t.modules.outbox.dead({ size: 10 })
    expect(dead.items).toEqual([expect.objectContaining({ queue: 'test.tellSomeone.on.card.created', event: 'card.created', attempts: 1, lastError: expect.stringContaining('the mail server is down') })])

    down = false
    await t.modules.outbox.retry(dead.items[0]!.id)
    await t.settled()

    expect((await t.modules.outbox.dead({ size: 10 })).total).toBe(0)
    // Done is done: it is not run again.
    await expect(t.modules.outbox.retry(dead.items[0]!.id)).rejects.toMatchObject({ code: 'outbox.job_not_dead', status: 409 })
  })
})
```

- The first: no email right after `assign`, the email once the worker ran, with the
  link. Assigning it again to bea tells nothing (chapter [10](./10-events)'s early
  return), so no second email.
- The second is the job run twice. It calls `notifyAssignee` as a worker would, with
  the event's id: twice with `event-1`, as a job whose first run failed after
  sending, then once with `event-2`, another assignment. Two emails, one per event,
  each with its key. (It runs before `settled`, so the worker's own email for the
  assignment is not in the list yet.)
- The third: a card created for bea is an email. A card given to bea and taken back
  before the worker runs is none: `notifyAssignee` reads it again and finds nobody.
- The fourth: nobody hears of a card they gave themselves.
- The fifth is the whole life of a dead job. The test subscribes a reaction of its
  own, with **one** attempt, that throws while "the mail server is down". After
  `settled`, the job is dead, and `outbox.dead` lists it with its error. Once the
  server is "back", `retry` puts it back, the worker runs it, and the list is empty.
  Retrying it again is a 409: it is done.

The fifth test's queue is no module's: there is no use case to name, and
`newt/queue-name` would refuse it. It says so where it is read, with the rule turned
off for that line. Only a test does that.

`attempts: 1` keeps the test fast: with the default 5, the second attempt would wait
10 seconds, and `settled` does not wait for a job that is not due.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

Then by hand. Start the backend (`bun cooper/backend/index.ts`), make a card, and
assign it to carl:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
post() { curl -s -X POST "$API$1" -H "$H" -H 'x-user: ana' -d "$2"; }
BOARD=$(post /boards "{\"name\":\"Mail $RANDOM\"}" | jq -r .id)
TODO=$(post /boards/$BOARD/columns '{"name":"To do"}' | jq -r .id)
CARD=$(post /boards/$BOARD/cards "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" | jq -r .id)
post /cards/$CARD/assign '{"assigneeId":"carl"}' | jq -c '{number, assigneeId}'
```

The answer comes first; a moment later the backend's console shows the email:

```text
[mail] from cooper <no-reply@cooper.local> to carl@cooper.test: #1 Plan is yours
  Hi carl,
  
  Card #1, "Plan", is assigned to you.
  
  http://localhost:5172/w/acme/boards/01a17958-afda-767a-a367-2b8833ba1c7c?card=01a17958-aff5-714a-9813-1a28017f15a0
```

with your board's and card's ids. Assign it to ana, who is the one acting, and no
email is written: she gave it to herself.

## What to remember

- What cannot be undone (an email, a call to another system) leaves from a worker,
  after the event of what it is about, never from the use case that makes the change.
  Its job is saved with the change, so it leaves only for what was saved.
- A worker that runs late reads again what it is about before acting: it may have
  changed since the event.
- A job may run twice. What it sends outside carries a key, the event's id, and the
  far side sends it once: every `Mailer` must honour `key`, a real one by passing it
  as the provider's idempotency key.
- What the application talks to outside (a mail service) is a port of its own,
  `Mailer`, handed to the context: the console in development, a list in tests.
- `when` decides, from the payload and before any job is written, which events a
  subscription takes. Business rules stay in the use case.
- A job that fails runs again after a backoff (10 s, doubling, up to 15 minutes),
  up to its `attempts` (5 by default); then it is dead. The `Outbox` port lists jobs
  (`list`, `get`) and puts a dead one back (`retry`); cooper's `Outbox_Module` does it
  for each context.

Next: [Listening to another context](./13-another-context).
