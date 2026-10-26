# C. Common problems

What you see, what it usually means, and what to do. Messages are quoted as newt and
cooper write them. cooper replaces some of newt's at startup with `setMessages`
([chapter 3](./03-pages-and-errors)); where they differ, both are given, cooper's
first. cooper's is what a person of the app sees; newt's is what a test or a script
sees, since they do not go through `index.ts`. The `code` is the same in both, and it
is what a client acts on.

## Saving

**"Someone else changed this a moment ago. Reload it and try again." / "Someone changed it in the meantime. Try again." (`concurrency_conflict`, 409)**
Two saves of the same row at once, and the use case already ran four times: newt runs a
use case again from the start on a `ConcurrencyConflict`, up to three more times, and
only the first of a chain. Either the row is very busy, or the use case says
`retryOnConflict: false` and so is not run again. Under heavy contention on one value
(a counter), take it in the save's `before` under a `guard`, so saves take turns
instead of colliding ([chapter 7](./07-cards-and-a-counter)). A use case that must
not run twice keeps `retryOnConflict: false` and lets the person try again
([chapter 8](./08-two-people-one-card), [chapter 18](./18-tenants-and-access)).

**"That is already taken: pick another one" / "There is already one with this name" (`duplicate_value`, 409)**
A unique index (or a table's `unique`) refused a row: someone took the value between
your check and your save. `DuplicateValue` is a kind of `ConcurrencyConflict`, so the
use case runs again once; its own check then finds the row and answers with the
module's error (`board.name_taken`). If you see `duplicate_value` itself, the use case
has no check of its own before saving: add one, for the clear answer, and keep the
index as the last word ([chapter 6](./06-rules-over-rows)). Where "given twice" means
"given once" (an access granted again), catch `DuplicateValue` and answer what is
there ([chapter 18](./18-tenants-and-access)). Remember that `NULL` is never equal
to `NULL` in an index: say it as a value when it is one.

**"[guard rule] column.add reads column in a save that guards nothing: on Postgres and MySQL another save may change what it read before it commits. Name what its rule protects in the save's guard"**
A save read rows in its transaction (in `before` or `after`, or a `find` through the
repository) and named no `guard`. On SQLite it would seem to work, since transactions
take turns; on Postgres they do not. Give the save the keys its rule protects,
``guard: [`columns:${boardId}`]``, or `guard: []` when what it reads needs none
([chapter 6](./06-rules-over-rows)). While an application adds its guards, the base's
`guardRule: 'warn'` turns the error into a warning.

**Two saves break a rule over several rows (two columns at position 3, eleven columns on a board).**
The save checks the rule in `after`, but guards a key too wide, too narrow, or folded
differently from how the rule compares (`Roadmap` and `roadmap`). Fold the key exactly
as the rule compares names ([chapter 6](./06-rules-over-rows)).

**A row created meanwhile slips past the check (a card moved into a column while it is reordered).**
A version protects a row that exists; a new one has none. Check the whole order in the
save's `after`, under a guard, and call `this.conflict()` when someone slipped in
([chapter 8](./08-two-people-one-card)).

**"A write runs inside `store.transaction`"**
Something wrote with a `SqliteStore`'s connection (or Kysely) outside a save. In a
repository, writes go inside `save` or `saveRows`. Outside one (a script, an adapter
such as `SqlAnalytics`), inside `store.transaction(…)`. Postgres and MySQL do not check
it: there a write outside a transaction runs at once, on its own. Wrap it the same, so
the code works on every store ([chapter 15](./15-kysely)).

**"This call belongs to a transaction that has ended: …"**
A call inside a transaction was left without `await`, or a branch of a `Promise.all`
kept running after another threw. It runs after the transaction committed or rolled
back, and fails instead of running outside it. Await every call; the lint's
`no-floating-promises` catches most ([appendix B](./b-module-anatomy)).

**"Waited 30000 ms for the store: a transaction holds it. …"**
Something waited too long for its turn. The usual cause is code running inside a
transaction that asks for the store from outside it, so it waits for itself: a save
from a callback that is not in the save's chain of `await` (an `EventEmitter`, a timer
started earlier). Move that work to a worker ([chapter 11](./11-reacting)).

**`database is locked`**
Another process held SQLite's write lock for more than 5 seconds: a script with a long
transaction while the backend runs, for example. It is not retried. Keep the script's
transactions short; with several processes writing at once, move to Postgres
([chapter 27](./27-postgres)).

## The write rule

**"[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo"**
A use case of one module saved in another without going through a worker. If it failed
halfway, nothing would finish it. Make the second module react to an event of the first
with a `'handler'` subscription ([chapter 13](./13-another-context)). Work over several
modules is a saga: run it from a worker, or by hand with `base.jobs.runAsWorker`
([chapter 14](./14-sagas)). If the person needs both writes in the answer, say the
exception where it is seen, `@UseCase({ writesTo: ['access'] })`, with the reason beside
it, and make sure a failure between the two leaves nothing half made
([chapter 8](./08-two-people-one-card), [chapter 17](./17-auth),
[chapter 18](./18-tenants-and-access)). A use case called from another context is the
root of what it does in its own: the rule holds there as for any other
([chapter 20](./20-wiring-contexts)). The base's `writeRule: 'warn'` turns the error into
a warning while an application moves to the rule.

## Asking twice

**"A request with this Idempotency-Key is still in progress: try again once it ends" (`idempotency_key_in_use`, 409)**
The client sent the same submit again while the first was still running (it gave up
waiting), or two requests with a new key arrived at once. Retry once the first ends; a
key held by a request that died is free again after a minute
([chapter 9](./09-idempotent-posts)).

**"This Idempotency-Key was sent before with another body: send a new key for another request" (`idempotency_key_reused`, 422)**
The client reused a key for a different request. That is the client's mistake: make a
new `crypto.randomUUID()` per submit, and send the same one only when sending the same
submit again ([chapter 23](./23-frontends)). The body is compared byte by byte.

**The same POST sent twice made two cards.**
The route has no `idempotency` option, the client sent no `Idempotency-Key`, or the two
were more than a day apart (`ttlMs`) ([chapter 9](./09-idempotent-posts)).

**A refused request, sent again with the same key, runs again.**
That is on purpose: what fails (an error thrown, a 5xx) is not kept, so the same key may
try again ([chapter 9](./09-idempotent-posts)).

## Workers

**A job never runs.**
Check, in order:
- Does the subscription say `strategy: 'handler'`? `'fire-and-forget'` writes no job,
  and is lost if it throws ([chapter 10](./10-events)).
- Did `when` take the event? An event it refuses leaves no job at all
  ([chapter 12](./12-failures)).
- Did the context start its worker? `runContexts` starts every one; a script that only
  `open`s a context runs no worker ([chapter 17](./17-auth)).
- In a test, do you wait with `base.jobs.idle()`, never a sleep, and on the right
  context? A job lives in the outbox of the context that **publishes** the event:
  boards' reaction to `tenant.created` runs on auth's worker. Wait for auth's jobs
  first, then boards' ([chapter 20](./20-wiring-contexts)).
- Did the save commit? A job is written in the save's transaction: a rollback takes it
  with it ([chapter 11](./11-reacting)).
- Is it due? A job that failed waits its backoff (10 s, doubling, up to 15 minutes)
  ([chapter 12](./12-failures)).

**`A handler of 'card.assigned' is named '<handler's module>.<use case it calls>.on.card.assigned', not '…'`**
At startup: the queue does not end with the event it is subscribed to, or does not have
the shape `<module>.<use case>.on.<module>.<event>`. `newt/queue-name` catches it, and
more, in the editor ([chapter 11](./11-reacting), [appendix B](./b-module-anatomy)).

**"[JobQueue] N job(s) of '…' wait, and no worker serves that queue: was its handler renamed or removed?"**
Jobs wait in a queue no worker has registered. The queue names the module, the use
case and the event (`card.notifyAssignee.on.card.assigned`), so renaming any of the three
leaves the old jobs waiting under the old name. Put the name back until they are done,
or write a script that does what those jobs were meant to do
([chapter 11](./11-reacting)).

**A job runs twice, and its effect shows twice.**
A job runs at least once, so maybe more: a worker that stopped halfway, a lease run out.
Make the second run find nothing to do, and key what leaves the process on the event's
`id` (the handler's second argument, `EventMeta`), the same for every run
([chapter 11](./11-reacting), [chapter 13](./13-another-context)).

**A job is `dead`.**
It ran out of attempts (5 by default). Its `lastError` says why. Fix the cause first,
then retry it: the backoffice's Jobs page lists each context's dead jobs and retries
them ([chapter 26](./26-dead-jobs-and-analytics)); without it, the context's
`outbox.dead` and `outbox.retry` use cases, or the store's `outbox.retry(id)`, do the
same ([chapter 12](./12-failures)). A dead job of a saga is work stuck halfway: give
such jobs more `attempts` ([chapter 14](./14-sagas)).

**"Job … is done, not dead: only a dead job is retried" (`outbox.job_not_dead`, 409)**
Someone retried it already, or it was never dead: one waiting or running is on its way.
Reload the list ([chapter 12](./12-failures)).

**A worker acts on what is no longer there (a card deleted since its event).**
A job may run late. Read again what it is about before acting, and do nothing if it is
gone ([chapter 12](./12-failures), [chapter 14](./14-sagas)).

**A schedule never ticks in a test.**
Schedules tick on the base's clock. Move the clock (`{ now: () => new Date(time) }`),
then call `base.schedules.tick()`. A new schedule waits for its next tick: the first call
tells nothing of before ([chapter 19](./19-invitations-and-time)).

## Things that appear a moment later

**A new workspace has no boards yet; a removed member is still a card's assignee; a card is missing from the search.**
Each is done by a worker after an event (`tenant.created`, `access.revoked`,
`card.created`), a moment later. Design the screen for that moment, and in tests wait
for the jobs ([chapter 13](./13-another-context), [chapter 16](./16-search-port),
[chapter 20](./20-wiring-contexts)). If it lasts, look for a dead job of that queue
among the publishing context's.

**The card search finds cards from before a restart, or misses some, with two processes.**
The in-memory search is one process: it is rebuilt as boards opens, and wrong as soon as
there are two. A search server is another adapter of the same port
([chapter 16](./16-search-port)).

## Who and where

**"You are not signed in, or your session has ended: sign in to go on" / "Sign in to continue" (`not_signed_in`, 401)**
A route that is not `public` was called without a session, or a use case that reads
`currentActor()` ran without an actor (`NoActor`): a script or a test calling it outside
`runAsActor`. A public route that wants to know who is there asks `findCurrentActor()`,
which returns `undefined` instead ([chapter 4](./04-who-and-where),
[chapter 21](./21-oauth-server)).

**"No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one"**
A boards repository ran outside a workspace. A route enters it through the workspace
group; an MCP tool with `inWorkspace`; a worker or a script with `runInWorkspace`. To
read across workspaces on purpose, a repository method uses `findInEveryScope`
([chapter 4](./04-who-and-where), [chapter 24](./24-mcp-server)).

**A member gets 404 for a workspace that exists.**
They do not belong to it: boards answers 404 so a stranger cannot tell it exists. Check
their access in auth ([chapter 4](./04-who-and-where), [chapter 18](./18-tenants-and-access)).

**`Property 'via' is missing` where an actor is given.**
cooper adds `via` (`'web'` or `'mcp'`) to newt's `Actor`, and it is required. Every
`runAsActor` and every authenticator says how the person came in:
`runAsActor({ userId, via: 'web' }, fn)` ([chapter 4](./04-who-and-where),
[chapter 24](./24-mcp-server)).

**A test signs in, but the routes see another person.**
A router has one authenticator, and the last one set wins. A test that wants its own
sets it after the context opens ([chapter 22](./22-web-session)).

**An entity's secret shows in an answer or an event.**
The entity has no public schema. `Entity<typeof Kept, typeof Public>` makes `toDTO()`
give only the public fields ([chapter 17](./17-auth)).

## Migrations

**"Migration 00001_board was changed after it was applied: put its up file back as it was, and make the change a new migration"**
The store keeps a checksum of each applied migration and refuses to open when one
changed. Put the file back (`git checkout` it), and write the change as the next
migration ([chapter 5](./05-sqlite), [chapter 18](./18-tenants-and-access)). Line ends
do not count: a checkout that turns `\n` into `\r\n` changes nothing.

**"Migrations … and … share the version …: renumber one"**
Two branches each added a migration with the same number. Renumber yours, the one not
applied anywhere yet ([chapter 27](./27-postgres)).

**"Last applied migration … is not in the migrations folder"**
The database is ahead of the code: you went back to a branch without a migration it
already applied. Go forward again, or undo that migration with `down` from the branch
that has it ([chapter 27](./27-postgres)).

**"The migrations folder '…' cannot be read"**
The path given to the store is wrong, or points at the other dialect's folder. newt
refuses to treat it as "no migrations" ([chapter 27](./27-postgres)).

**A table works on SQLite and not on Postgres.**
Each dialect has its own folder of migrations, `migrations/sqlite/` and
`migrations/postgres/`: a new migration goes in both ([chapter 27](./27-postgres)).

## The browser

**`Module "node:async_hooks" has been externalized for browser compatibility, imported by ".../packages/newt/core/scope/define-scope.ts"`**
A frontend pulled `newt/core` in, through a schema or a value object that imports it.
A browser has no `node:async_hooks`. A `*.schema.ts` and its value objects import
`newt/contract`, never `newt/core` ([chapter 23](./23-frontends)).

**A client shows a message that changed, or breaks when it does.**
It acts on the message. Act on `code`, which never changes; read every failure as an
`ErrorBody` ([chapter 3](./03-pages-and-errors), [chapter 23](./23-frontends)).

**A cross-origin call fails, or sends no cookie.**
The route says no `cors`, or relies on cookies across origins. A route other pages call
says so with `cors`, and proves who calls with a token, never a cookie
([chapter 21](./21-oauth-server), [chapter 24](./24-mcp-server)).

## Running cooper

**"…: port 3002 is already in use" and "Nothing was started."**
`bun run cooper` checks every port first. Another cooper, or something else, is
listening. Stop it, or move cooper with the `COOPER_*_PORT` and `COOPER_*_PUBLIC_URL`
variables; in development the Vite servers' proxies read the same `COOPER_*_PORT`
([chapter 23](./23-frontends), [chapter 29](./29-shipping)).

**A page answers "The frontend is not built: its folder has no index.html".**
You opened a context's own port without building the frontends. In development, open
the Vite servers' URLs (5171, 5172, 5173). In production, run `bun run cooper:build`
first ([chapter 23](./23-frontends), [chapter 29](./29-shipping)).

**The lint stops before linting anything: "newt-eslint: contexts never use each other in a cycle, …"**
`contexts.uses` in `eslint.config.js` names a context it does not list, or makes a
cycle ([appendix B](./b-module-anatomy#newt-context-boundaries)).

**Nothing is traced.**
No tracer was set, or each context got its own: give one tracer to `runContexts`, for
every context of the process ([chapter 28](./28-observability)).
