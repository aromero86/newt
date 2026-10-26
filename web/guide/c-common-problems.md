# C. Common problems

What you see, what it usually means, and what to do. The messages are quoted as newt
and cooper write them.

## Saving

**"Someone changed it in the meantime. Try again." (`ConcurrencyConflict`, 409)**
Two saves of the same thing at once, and the use case already ran four times (or says
`retryOnConflict: false`). If it is a new row that collides with a unique value (two
boards named "Roadmap"), it is the protection working: cooper turns that case into
`board.name_taken`, and the user picks another name. ([chapter 7](./07-concurrency))

**Two saves break a rule over several rows: two admins, two cards with number #7.**
The save that checks the rule in its `after` does not guard what it protects. Add its
key: `guard: ['cardNumbers:<board>']`. On SQLite it seems to work without it, because
saves take turns anyway; on Postgres and MySQL it does not.
([chapter 8](./08-rules-over-rows))

**"A write runs inside `store.transaction`"**
Something wrote with a `SqliteStore`'s connection (or Kysely) outside a save. In a
repository, writes go inside `save` or `saveRows`. Outside one (a script, an adapter
such as `SqliteAnalytics`), inside `store.transaction(…)`. Postgres and MySQL do not
check it: there a write outside a transaction runs at once, on its own. Wrap it the
same, so the code works on every store.

**"Waited 30000 ms for the store: a transaction holds it."**
Something waited too long for its turn. The usual cause is code running inside a
transaction that asks for the store from outside it, so it waits for itself. It
happens when saving from a callback that is not in the save's chain of `await` (an
`EventEmitter`, a timer started earlier). Move that work to a worker.

**`database is locked`**
Another process held SQLite's write lock for more than 5 seconds: a script with a long
transaction while the backend runs, for example. It is not retried. Make the script's
transactions short. ([chapter 26](./26-production))

## The write rule

**"[write rule] … writes to … outside a worker: write it from a worker reacting to an event, or list it in its writesTo"**
A use case of one module saved in another without going through a worker. If it fails
halfway, nothing will finish it. Make the second module react to an event of the
first with a `handler`. If the exception is justified, say it where it is seen:
`@UseCase({ writesTo: ['column'] })`, with the reason beside it, as `card.removeColumn`
does. ([chapter 17](./17-modules-talk))

## Workers

**A worker does not run.**
Did the context `start()`? Does the subscription say `strategy: 'handler'`, and not
`'fire-and-forget'`? In a test or a script, do you wait with `jobs.idle()`, and on the
right context? The job lives in the outbox of the context that **publishes** the
event: boards' reaction to `tenant.created` runs on auth's worker.
([chapter 25](./25-tests))

**`A handler of '…' is named '<handler's module>.<use case it calls>.on.…', not '…'`**
At startup: the queue does not end with the event it is subscribed to, or does not
have the shape `<module>.<use case>.on.<event>`. `newt/queue-name` catches it earlier,
in the editor. ([chapter 11](./11-reacting))

**"[JobQueue] N job(s) of '…' wait, and no worker serves that queue: was its handler renamed or removed?"**
Jobs wait in a queue no worker has served for five minutes. The queue's name says the
module, the use case and the event (`metric.recordCard.on.card.created`), so renaming
any of the three leaves the old jobs waiting under the old name. Put the name back,
or write a script that does what those jobs were meant to do.

**A job is `dead`.**
It ran out of attempts. Look at its `lastError` in `store.outbox.list()`, fix the
cause, and put it back with `store.outbox.retry(id)`. A dead job is a flow stuck
halfway: [chapter 16](./16-sagas) shows how to think about it.

## Things that appear a moment later

**A new workspace has no boards.**
Its welcome board is made by a worker after `tenant.created`. It appears a moment
later. Design the screen for that moment. ([chapter 12](./12-eventual-consistency))

**Someone removed from a workspace is still a card's assignee.**
For a moment, that is normal: the card is unassigned by a worker after
`access.revoked`. If it lasts, look for a dead `card.unassignMember.on.access.revoked`
job in auth's outbox.

**The backoffice's numbers are behind.**
They are a projection, written by workers after the events of auth and boards. If they
stay behind, look for dead `metric.*` jobs in auth's and boards' outboxes.
([chapter 22](./22-backoffice))

## Who and where

**"Sign in to continue" (`not_signed_in`, 401)**
A route that is not `public` was called without a session, or a use case that reads
`currentActor()` ran without an actor: a script or a test calling it outside
`runAsActor`.

**"No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one"**
A boards repository ran outside a workspace. A route enters it through the workspace
group; an MCP tool with `inWorkspace`; a worker or a script with `runInWorkspace`.
([chapter 5](./05-who-and-where))

**A member gets 404 for a workspace that exists (`workspace.not_found`).**
They do not belong to it: boards answers 404 so a stranger cannot tell it exists.
Check their access in auth.

**Someone of the staff gets 403 in the backoffice (`staff.not_staff`).**
Their access to the product `backoffice` was taken away, maybe after they signed in.
The backoffice checks it on every request. Someone else of the staff can grant it
again.

**Signing in to the backoffice stops at auth with `oauthGrant.no_access`.**
The account is not of the staff: the product `backoffice` lets in only whom it was
told. A staff member grants it from the backoffice's staff page, or the seed makes the
first one.

## Migrations

**"Migrations … and … share the version …: renumber one"**
Two branches each added a migration with the same number. Renumber yours, the one not
applied anywhere yet. ([chapter 24](./24-migrations))

**"Last applied migration … is not in the migrations folder"**
The database is ahead of the code: you went back to a branch without a migration it
already applied. Go forward again, or undo that migration with `down` from the branch
that has it.

**"The migrations folder '…' cannot be read"**
The path given to `open` is wrong. newt refuses to treat it as "no migrations".

**A column you added to a migration is not there.**
You edited a migration that was already applied: the database never runs it again.
Write a new one. ([chapter 24](./24-migrations))

## Running cooper

**"…: port 3002 is already in use" and "Nothing was started."**
`bun run cooper` checks every port first. Another cooper, or something else, is
listening. Stop it, or move cooper with the `COOPER_*_PORT` and `COOPER_*_PUBLIC_URL`
variables. ([chapter 26](./26-production))

**A page answers "The frontend is not built: its folder has no index.html".**
You opened a context's own port without building the frontends. In development, open
the Vite servers' URLs (5171, 5172, 5173). In production, run `bun run cooper:build`
first.

**The seed fails reading Bob's invitation link.**
The backend was running, and its worker sent the email before the seed's did. Stop
the backend and run the seed again. ([chapter 26](./26-production))
