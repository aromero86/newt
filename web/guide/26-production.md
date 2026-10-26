# In production

cooper runs on your machine with one command. This last chapter goes through what is
around the contexts: the scripts, how the backend starts and stops, the settings it
reads, what happens when more than one process works on the same data, and what would
change if cooper left SQLite.

## The scripts

They are in the root `package.json`:

```json
"cooper": "bun run cooper/scripts/dev.ts --watch",
"cooper:seed": "bun run cooper/scripts/seed.ts",
"cooper:build": "vite build cooper/frontend/auth && vite build cooper/frontend/boards && vite build cooper/frontend/backoffice"
```

### `cooper:seed`: demo data, through the use cases

The seed opens the contexts as the server does, and writes through their use cases as
anyone would: a staff account, Ana's workspace Acme, Bob invited and accepted, a
second board. It never writes rows by hand, so every rule holds, and every event is
published as it would be.

```ts
// cooper/scripts/seed.ts
const contexts = await openContexts(config, { mailer: { send: async mail => { mails.push(mail); await console_.send(mail) } } })
/**
 * Until the background work is done: auth's jobs first, boards' reactions to auth's
 * events among them (Acme's welcome board), then what those made boards tell.
 */
const settled = async () => {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}

try {
  const { user, access, tenant, invitation } = contexts.auth.modules

  /** An account, made the first time. */
  const account = async (email: string, name: string) => (await user.findByEmail(email)) ?? user.signUp({ email, name, password: PASSWORD })

  const staff = await account('staff@cooper.dev', 'Cooper Staff')
  await access.admit({ userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' })
  // …
} finally {
  await stopContexts(contexts)
}
```

Three habits of a good script are in it:

- **It acts as someone.** A use case that needs an actor runs inside `runAsActor`
  (`asAna(() => tenant.create({ name: 'Acme' }))`), and boards' use cases run inside
  the workspace too, with `inWorkspace`.
- **It waits for its workers before it closes**, with `jobs.idle()`, in the order the
  work flows ([chapter 25](./25-tests)). Bob's invitation email is sent by a worker,
  and the seed reads the link from it.
- **It can run again.** It looks before it creates (`findByEmail`, `findByName`), so a
  second run leaves what is there.

### `cooper`: development

`dev.ts` starts four processes: the backend (`bun --watch cooper/backend/index.ts`,
which restarts on every change) and one Vite server per frontend, which sends the
API's paths on to its context's port. It checks first that every port is free, and
stops everything if one process dies.

### `cooper:build`: the frontends for production

Each frontend builds into `dist/cooper/<name>`. In production there are no Vite
servers: each context serves its own built frontend, on its own port, for every
address its routes do not take:

```ts
// cooper/backend/shared/served-context.ts
/** Its server: its modules' API, what it adds, and its frontend for any other address. */
serve(): Server<undefined> {
  return serve({ port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder })
}
```

If the folder has no `index.html`, the pages answer `503 The frontend is not built`,
and the API still works.

## Starting and stopping

The backend is one process with the three contexts, each served on its own port:

```ts
// cooper/backend/index.ts
const contexts = await openContexts(config)

const servers = contexts.all.map(context => {
  const server = context.serve()
  console.log(`${context.name} listening on ${server.url}`)
  return server
})
for (const context of contexts.all) context.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
    process.exit(0)
  })
}
```

- **Starting**: open the contexts in order (auth, boards, backoffice), each applying
  its migrations; serve them; start each one's worker with `context.start()`.
- **Stopping**: stop accepting requests first (`server.stop()`, which lets the ones in
  progress finish), then stop the contexts, the last opened first:

```ts
// cooper/backend/open-contexts.ts
/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
```

`context.stop()` stops its worker claiming new jobs, waits for those in progress, and
closes its store. What was still pending stays pending, in the outbox, and runs when
the backend comes back.

Each context answers `GET /api/health` without a session, for whatever watches that it
is up.

::: tip
After a deploy, watch the logs for `[JobQueue] N job(s) of '…' wait, and no worker
serves that queue`. newt warns about a queue with jobs that no worker has served for
five minutes. It almost always means a handler, a use case or a module was renamed,
and the old jobs wait under the old name ([chapter 11](./11-reacting)).
:::

## Settings

Everything comes from environment variables, read once in `cooper/backend/config.ts`,
with defaults for development. Bun loads a `.env` file on its own.

| Variable | Default | What it is |
|---|---|---|
| `COOPER_AUTH_PORT` | `3001` | Where auth listens. |
| `COOPER_BOARDS_PORT` | `3002` | Where boards listens. |
| `COOPER_BACKOFFICE_PORT` | `3003` | Where the backoffice listens. |
| `COOPER_AUTH_DB_PATH` | `data/cooper-auth.db` | auth's database file. |
| `COOPER_BOARDS_DB_PATH` | `data/cooper-boards.db` | boards' database file. |
| `COOPER_BACKOFFICE_DB_PATH` | `data/cooper-backoffice.db` | The backoffice's database file. |
| `COOPER_AUTH_PUBLIC_URL` | `http://localhost:5171` | Where people open auth. |
| `COOPER_BOARDS_PUBLIC_URL` | `http://localhost:5172` | Where people open boards. |
| `COOPER_BACKOFFICE_PUBLIC_URL` | `http://localhost:5173` | Where people open the backoffice. |
| `COOPER_BOARDS_CLIENT_SECRET` | a development secret | boards' OAuth client secret. |
| `COOPER_BACKOFFICE_CLIENT_SECRET` | a development secret | The backoffice's OAuth client secret. |
| `COOPER_SESSION_DAYS` | `30` | How long a browser session lasts, in every context. |
| `COOPER_INVITATION_DAYS` | `7` | How long an invitation waits to be accepted. |
| `COOPER_OAUTH_ACCESS_MINUTES` | `60` | How long an access token lasts. |
| `COOPER_OAUTH_REFRESH_DAYS` | `30` | How long an unused refresh token lasts. |
| `COOPER_MAIL_FROM` | `cooper <no-reply@cooper.local>` | Who the emails come from. |
| `COOPER_AUTH_FRONTEND` | `dist/cooper/auth` | auth's built frontend. |
| `COOPER_BOARDS_FRONTEND` | `dist/cooper/boards` | boards' built frontend. |
| `COOPER_BACKOFFICE_FRONTEND` | `dist/cooper/backoffice` | The backoffice's built frontend. |
| `COOPER_TRACE` | off | `1` writes each use case of the backoffice to the console ([chapter 22](./22-backoffice)). |

Relative paths are relative to the repository's root. In development the public URLs
are the Vite servers; in production, each context's own domain, in front of its port.
Each context on its own domain also keeps its cookies to itself.

::: warning
The client secrets have development defaults so that cooper runs with no setup. In
production, set both: with the defaults, anyone who read this page could act as
boards at auth's token endpoint.
:::

The mailer is the one setting that is not a variable: `openContexts` takes it as an
option, and uses `ConsoleMailer` (emails written to the console) when none is given.
A real one (SMTP, an email API) is any object with the same `send(mail)`: the type
`Mailer`, in `shared/mail/mailer.ts`.

## Several processes on the same data

A server and a script can work on the same database at once: you run the seed, or a
script that fixes data, while the backend is up. What happens then?

- **Transactions take turns across processes.** SQLite lets one process write at a
  time. The other waits, up to **5 seconds**, and then fails with
  `database is locked`. That is not a `ConcurrencyConflict`, so no use case retries
  it. A script with one long transaction makes the server's requests fail behind it:
  keep scripts in short transactions, one row or a small batch each.
- **Jobs are shared.** The outbox is in the database, so the server's worker and a
  script's `jobs.idle()` take jobs from the same queue. Each job is claimed by one of
  them, with a lease, and closed only by whoever claimed it. A job never runs twice
  at once. But it may run in the **other** process.

That last point matters for the seed. It reads Bob's invitation link from the emails
**its own** mailer received. If the server's worker claims that job first, the email
leaves from the server, and the seed does not find it. Run the seed with the backend
stopped.

## Choosing another store

cooper runs on SQLite: one file per context, nothing to install, transactions one at a
time. It is a good place to start, and it carries a single machine a long way. When
you need several servers on the same data, or many writes at once, newt also has
`PostgresStore` and `MySqlStore` (`newt/adapter-postgres`, `newt/adapter-mysql`),
opened with a URL:

```ts
// packages/newt/adapter-postgres/postgres-store.ts
static async open(options: SqlStoreOptions): Promise<PostgresStore> {
```

The modules would not change. Here is what would, in cooper, following
`docs/stores.md`:

- **Opening the store.** Each context's `open` calls `SqliteStore.open(…)`; it would
  call `PostgresStore.open({ url, migrations })` instead. `CooperBase` says
  `Base<SqliteStore>`, so its type changes with it.
- **The migrations**, rewritten in the new dialect, in a folder of their own, with
  the same file pairs. On Postgres, text columns are best `COLLATE "C"`, so text sorts
  and compares by code point as on SQLite; booleans are `BOOLEAN`, JSON is `JSONB`.
  boards' `lower(name)` unique index works as it is. On MySQL, ids are
  `VARCHAR(36)`, text columns `utf8mb4_0900_bin`, and a unique value among the rows
  not deleted is a functional index on `IF(deleted_at IS NULL, …, NULL)`.
- **Transactions run side by side.** This is where the `guard` keys of cooper's saves
  earn their keep: a board's card numbers (`cardNumbers:<board>`), a column's cards
  (`cards:<column>`), a board's columns (`columns:<board>`), a board's name
  (`boardName:<workspace>:<name>`), a workspace's admin (`tenantAdmin:<tenant>`), an
  email's account (`userEmail:<email>`). On SQLite every save takes its turn anyway, so a missing
  guard goes unnoticed. On Postgres and MySQL each guard is a lock in the database, and
  a save without one breaks its rule without a sound. A deadlock becomes a
  `ConcurrencyConflict`, and the use case runs again.
- **Kysely runs as it is.** The counts already pass through `Number(…)`, which a
  Postgres `COUNT` needs.
- **What is marked as SQLite's** is what to rewrite. `SqliteAnalytics` uses SQLite's
  connection and `json_extract`. On another store it would be another adapter of the
  analytics port, or a real analytical database (DuckDB, ClickHouse).
- **Files are not an option** for boards: its base uses Kysely, which needs a SQL
  store.

`ieq` compares the same in every store: A to Z only, whatever the case. `Ñ` and `ñ`
differ on SQLite, Postgres and MySQL alike.

## In short

- Scripts open the contexts as the server does, act through use cases with
  `runAsActor`, and wait for their workers with `jobs.idle()` before closing.
- Start: open the contexts in order, serve, start the workers. Stop: stop serving,
  then stop the contexts, the last opened first. Pending jobs wait for the next start.
- Settings come from the environment, with development defaults. Set the secrets in
  production.
- Several processes share the database and its outbox. Keep a script's transactions
  short; a job may run in either process.
- Another store changes the opening, the migrations and anything marked as SQLite's.
  The modules stay. The `guard` keys start to matter.
