# Stores and migrations

<p class="chapter-lead">Every context keeps its data somewhere: a SQLite file on a laptop, a
Postgres database in production, a folder of JSON files for a small tool. This chapter shows
the one port all of them implement, the four adapters newt ships, how a context's structure
changes over time through migrations, and how you would write a store of your own and prove
it keeps its promises.</p>

## The problem

cooper runs on SQLite while you build it. Each context has a file of its own under `data/`,
the tests open `:memory:`, and nobody installs a database. Then cooper goes to production, and
production wants Postgres: several instances behind a load balancer, backups the operations
team already knows, a database that runs transactions side by side.

In most frameworks that move is a rewrite of the data layer. Queries were written for one
database, transactions were opened by hand, and a rule that held because SQLite runs one
writer at a time quietly stops holding.

In newt it is one line in a function that opens the store, and a second folder of migrations.
No module, repository or use case changes. That is not luck: it is how the store is drawn.

## The idea

::: info Concept: Store
A **store** is where one bounded context keeps its data. It is a port, `Store`, from
`@newt-kit/newt/port-store`: transactions, tables of rows with versions, an outbox of jobs, and
migrations. Each database is an adapter of that port. A context owns exactly one store, and
no other context reads it.
:::

A repository never knows which store it runs on. It talks to the port, and the port is small:

```ts
// packages/newt/port-store/store.ts
export interface Store {
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
  guard(keys: string[]): Promise<void>
  afterCommit(fn: () => void): void
  afterRollback(fn: () => void): void
  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): Table<Row>
  readonly outbox: Outbox
  readonly migrations: Migrations
  close(): Promise<void>
}
```

```mermaid
flowchart LR
  R["Card_Repository"] --> P["Store port"]
  P --> S["SqliteStore"]
  P --> F["FileStore"]
  P --> PG["PostgresStore"]
  P --> M["MySqlStore"]
  P --> Y["your own store"]
  PG --> SQL["@newt-kit/newt/sql"]
  M --> SQL
  S --> SQL
```

The port is small, but what it promises is not. Every adapter keeps these five promises, and
a contract suite checks each one (you meet it at the end of this chapter):

- **A transaction is all or nothing.** What `transaction` writes, its outbox jobs included, is
  stored together or not at all. A call inside one joins it: there is only ever the outermost.
- **The current transaction follows the code.** Whatever runs inside `fn`, however deep and
  across `await`s, reads and writes in it without being handed it.
- **Transactions that guard the same key never interleave.** This is what keeps a rule over
  several rows true; [Versions, conflicts and guards](./20-concurrency) tells that story whole.
- **Reads outside a transaction see only what is committed.**
- **A stored row keeps its version**: a write that finds another throws `ConcurrencyConflict`,
  and a new row whose key or unique value is taken throws `DuplicateValue`.

::: tip In cooper
cooper never names an adapter outside one file, `cooper/backend/shared/open-store.ts`. Every
context opens its store through it, from the address in `COOPER_<CONTEXT>_DATABASE`.
:::

## Tables

A repository does not write SQL. It works on a **table**: rows with an `id` and a `version`,
found by criteria and written with their version checked.

```ts
// packages/newt/port-store/table.ts
export interface Table<Row extends StoredRow> {
  find(criteria?: Criteria<Row>, options?: FindOptions<Row>): Promise<Row[]>
  count(criteria?: Criteria<Row>): Promise<number>
  insert(row: NewRow<Row>): Promise<void>                                  // version 1
  update(id: string, version: number, changes: Partial<NewRow<Row>>): Promise<void>
  patch(id: string, changes: Partial<NewRow<Row>>): Promise<void>          // whatever its version
  delete(id: string, version: number): Promise<void>
  deleteMany(criteria: Criteria<Row>): Promise<number>
}
```

`update` and `delete` take the version the row was read at; a row at another version is a
`ConcurrencyConflict`. `patch` is the one write that ignores the version, for what only notes
that something happened (`lastUsedAt`). `deleteMany` removes for good, and is what a
repository's `purge` runs on.

A table is described to every store in the same words, so a repository moves from one store
to another unchanged. `store.table(name, options)` takes two options from the port:

```ts
// packages/newt/port-store/table-options.ts
export type TableOptions<Row> = {
  /** The fields a store may not keep as they are: SQLite keeps a boolean as 0 or 1, and JSON as text. */
  types?: Partial<Record<keyof Row & string, FieldType>>   // 'boolean' | 'json'
  /** The fields, alone or together, no two rows share, a row deleted softly aside. */
  unique?: (keyof Row & string)[][]
}
```

A store that does not need an option ignores it. SQLite's unique values are its indexes, so it
ignores `unique`; the files store has no indexes, so `unique` is the only thing that stops two
rows from sharing a value there. You write both anyway, because the repository should not know
which store it is on.

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
  softDelete: true,
  scope: { field: 'workspaceId', current: currentWorkspaceId },
})
```

### Fields and columns

Rows speak in camel case, as the rest of your TypeScript does: `workspaceId`, `deletedAt`. The
SQL tables speak in snake case: `workspace_id`, `deleted_at`. The SQL table translates on its
own: a field's column is the field in snake case. When a column is named otherwise, the SQL
stores take one more option, `columns`:

```ts
// packages/newt/sql/sql-table-options.ts
export type SqlTableOptions<Row> = {
  /** The column of a field, when it is not the field in snake case (`workspaceId` → `workspace_id`). */
  columns?: Partial<Record<keyof Row & string, string>>
}
```

So the migration says `workspace_id TEXT NOT NULL`, and the row type says `workspaceId: string`.
Kysely, through `kyselyFor` from `@newt-kit/newt/kysely`, does the same translation, so a query in a
repository names `workspaceId` too ([Queries, analytics and ports](./25-queries)).

::: warning Watch out
A field must be in camel case for its column to name it back. A field called `workspace_id`
in the row type, or a column called `workspaceID` in the migration, will not round trip. Keep
fields camel case and columns snake case, and use `columns` only for a column you do not own.
:::

::: details Under the hood: what a table cannot say
A table is the common ground every store can offer. What it cannot say (a join, a `GROUP BY`,
a full-text search) a repository asks the adapter directly, and every adapter has a handle for
it: `SqliteStore.connection` (a `bun:sqlite` database whose statements run on the right
connection when they run), `query(text, params)` on the Postgres and MySQL stores, and
`collection(name)` on the files store. Whatever you run through those handles joins the
transaction in progress. You never open a transaction of your own on them: write through the
repository's `save` or `saveRows`.
:::

## The four adapters

newt ships four stores, each its own subpath export, each opened with a static `open` that
also brings it up to date.

| Adapter | Export | Opened with | Transactions |
|---|---|---|---|
| `SqliteStore` | `@newt-kit/newt/adapter-sqlite` | `{ path, migrations?, waitTimeoutMs? }` | One at a time, in the process |
| `FileStore` | `@newt-kit/newt/adapter-files` | `{ folder, migrations?, waitTimeoutMs? }` | One at a time, across processes on one host |
| `PostgresStore` | `@newt-kit/newt/adapter-postgres` | `{ url, migrations?, connections?, waitTimeoutMs? }` | Side by side, in the database |
| `MySqlStore` | `@newt-kit/newt/adapter-mysql` | `{ url, migrations?, connections?, waitTimeoutMs? }` | Side by side, in the database |

### SQLite

```ts
// cooper/backend/shared/open-store.ts
SqliteStore.open({ path: database, migrations: join(migrations, 'sqlite') })
```

SQLite, on `bun:sqlite`, is where every newt app starts. Transactions run one at a time, in
the order they ask, on a connection that writes (`BEGIN IMMEDIATE`). Reads outside them go to
a second, read-only connection, which in WAL mode sees only what is committed. A write outside
a transaction is refused, with a clear error.

`path: ':memory:'` is not SQLite's in-memory database: it is a temporary file, removed on
`close`. So a test runs with exactly the semantics of production, second connection included.
`waitTimeoutMs` (30 s by default) is how long a call waits behind the transactions before it
gives up, saying why.

Choose it for development, for tests, and for production on one machine. One file per context,
nothing to install, nothing to run beside your server.

### Files

```ts
const store = await FileStore.open({ folder: 'data/boards', migrations: [/* FileMigration */] })
```

The files store keeps one JSON file per record, one folder per collection
(`data/boards/card/<id>.json`). Its transactions are its own: what one writes waits in memory,
and on commit goes to a journal (`_journal.json`) flushed to disk, then each record is written
whole, then the journal goes. A crash after the journal is written is finished by whoever takes
the lock next. One lock file, `_lock`, lets several processes on one host share a folder.

Every find reads the whole collection. It is for thousands of records, not millions: prototypes,
tests, small tools, settings. It has no SQL, so Kysely does not run on it.

### Postgres and MySQL

```ts
// cooper/backend/shared/open-store.ts
PostgresStore.open({ url: database, migrations: join(migrations, 'postgres') })
```

```ts
const store = await MySqlStore.open({ url: 'mysql://user:password@host:3306/boards?sslmode=require', migrations: 'migrations/mysql' })
```

Both run on `Bun.SQL`, so there is no driver to install. Both keep a pool of connections
(`connections`, 10 by default); each transaction reserves one until it ends. They share their
code in `@newt-kit/newt/sql` (`SqlStore`, `SqlTable`, `SqlOutbox`, `SqlMigrationRunner`); what tells them
apart is a dialect.

Transactions run side by side, both at `READ COMMITTED` (MySQL's default is `REPEATABLE READ`;
the store sets the level on each transaction). A transaction the database gives up, a deadlock
or a serialization failure, becomes a `ConcurrencyConflict`, which the use case runs again.
On these two stores `waitTimeoutMs` bounds how long a `guard` waits for a key another
transaction holds; how each one turns a key into a lock is in
[chapter 20](./20-concurrency).

Choose Postgres for production with several instances, or whenever the operations around you
already speak it. MySQL is there for teams whose operations speak MySQL; cooper does not ship
it, but it would be one more branch in `openStore`.

```mermaid
flowchart TD
  Q1{"Several processes<br/>writing at once?"} -->|no| Q2{"More than a few<br/>thousand records?"}
  Q1 -->|yes| Q3{"Which database does<br/>your team run?"}
  Q2 -->|no| FILES["FileStore or SqliteStore"]
  Q2 -->|yes| SQLITE["SqliteStore"]
  Q3 -->|Postgres| PG["PostgresStore"]
  Q3 -->|MySQL| MY["MySqlStore"]
```

::: warning Watch out
A unit of work that runs on SQLite only by luck breaks the day it runs on Postgres. SQLite
takes turns, so a rule over several rows read without a guard holds there in every test. That
is why newt's guard rule fails such a save on every store, SQLite included: the error shows up
on your laptop, not in production. See [chapter 20](./20-concurrency).
:::

## Opening a store in cooper

Each context opens its store as it opens, from where its configuration says the database is:

```ts
// cooper/backend/shared/open-store.ts
/** A store cooper runs on: SQLite, or Postgres. */
export type CooperStore = SqliteStore | PostgresStore

/** Whether a context's database is a Postgres server, by its address. */
const isPostgres = (database: string) => /^postgres(ql)?:\/\//.test(database)

export function openStore(database: string, migrations: string): Promise<CooperStore> {
  return isPostgres(database)
    ? PostgresStore.open({ url: database, migrations: join(migrations, 'postgres') })
    : SqliteStore.open({ path: database, migrations: join(migrations, 'sqlite') })
}

/** The same store as it is, migrating nothing: for the script that migrates it. */
export function connectStore(database: string, migrations: string): Promise<CooperStore> {
  return isPostgres(database)
    ? PostgresStore.connect({ url: database, migrations: join(migrations, 'postgres') })
    : SqliteStore.connect({ path: database, migrations: join(migrations, 'sqlite') })
}
```

boards hands it its own folder of migrations, and builds its base on the store:

```ts
// cooper/backend/contexts/boards/boards.context.ts
static async open(config: Boards_Config, deps: Boards_ModuleDeps, clock?: Clock): Promise<Boards_Context> {
  const store = await openStore(config.database, join(import.meta.dir, 'migrations'))
  const base = new BoardsBase({ name: 'boards', store, clock })
  // …
}
```

`config.boards.database` is `data/cooper-boards.db` unless `COOPER_BOARDS_DATABASE` says
otherwise (`cooper/backend/config.ts`). Set it to a `postgres://` address and boards runs on
Postgres, with nothing else changed.

::: tip In cooper
Each context has a database of its own: `auth`, `boards` and `backoffice` never share one,
even on the same Postgres server. A context owns its data; another context asks its modules.
:::

## Migrations

A context's tables are not created by the code that uses them. They are created, and changed,
by **migrations**: numbered scripts, applied in order, remembered by the store.

::: info Concept: Migration
A **migration** is one change to a store's structure: an up script that makes it, and a down
script that undoes it. The store keeps the list of the ones it applied, so opening it applies
only what is pending. An applied migration is history: it never changes.
:::

The port says what a store does with them:

```ts
// packages/newt/port-store/migrations.ts
export interface Migrations {
  /** Applies every pending one, all of them or none; the ones it applied. */
  up(): Promise<string[]>
  /** Reverts the last one applied; the one it reverted, if any. */
  down(): Promise<string | null>
  /** What is applied and what is pending, in order; and `changed`. */
  status(): Promise<MigrationStatus>
}

export type MigrationStatus = { applied: string[], pending: string[], changed: string[] }
```

### Files, per dialect

On the SQL stores a migration is a pair of files in a folder, `000NN_<name>_up.sql` and
`000NN_<name>_down.sql`, the version zero-padded to five digits. SQL is a dialect, so each
database gets its own folder of the same pairs, with the same numbers and names:

```text
cooper/backend/contexts/boards/migrations/
  sqlite/
    00001_board_up.sql      00001_board_down.sql
    00002_column_up.sql     00002_column_down.sql
    00003_card_up.sql       00003_card_down.sql
    …
  postgres/
    00001_board_up.sql      00001_board_down.sql
    …
```

`sqlite/00001_board_up.sql` and `postgres/00001_board_up.sql` are the same change, each in its
own words. Most of a Postgres twin is the SQLite file with text columns `COLLATE "C"`, so they
compare and sort by code point as every store does:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00001_board_up.sql
CREATE TABLE board (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00001_board_up.sql
CREATE TABLE board (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  -- …
  deleted_at TEXT COLLATE "C",
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z: `lower` of a "C" column, as `ieq` compares).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

Every entity's table has `id` as its primary key and `version INTEGER NOT NULL`. A value unique
among the rows not deleted is a **partial unique index** (`WHERE deleted_at IS NULL`): an
archived board does not hold its name. The other differences between dialects are few and
mechanical:

| | SQLite | Postgres | MySQL |
|---|---|---|---|
| Text | `TEXT` | `TEXT COLLATE "C"` | `utf8mb4_0900_bin` |
| Id | `TEXT PRIMARY KEY` | `TEXT PRIMARY KEY` | `VARCHAR(36) PRIMARY KEY` |
| Boolean | `INTEGER` (0, 1), `types: { x: 'boolean' }` | `BOOLEAN` | 0 and 1 |
| JSON | `TEXT`, `types: { x: 'json' }` | `JSONB` | `JSON` |
| Unique among live rows | partial index | partial index | functional index on `IF(deleted_at IS NULL, col, NULL)` |

The files store has no structure to change, so its migrations are not files but code: a
`FileMigration` with a `version`, a `name`, and `up` and `down` functions that transform
records through `store.collection(name)`.

### Applied at open

`open` applies every pending migration before it hands you the store. On SQLite and Postgres the
batch runs in one transaction: all of it or none. If anything fails, `open` closes the store and
throws, so a server never starts on a half-migrated database.

After the context's own migrations, the store applies **the framework's**: the tables of its
outbox and its schedules (`job`, `job_queue`, `schedule_tick`). They live inside newt
(`packages/newt/adapter-sqlite/migrations`, `packages/newt/sql/migrations/postgres`,
`.../mysql`) and are remembered in a table of their own, `framework_migrations`, so they are
numbered apart from yours. Your `migrations` table holds only your own.

```mermaid
sequenceDiagram
  participant C as Boards_Context.open
  participant S as SqliteStore.open
  participant DB as Database
  C->>S: open({ path, migrations })
  S->>DB: BEGIN, holding the write lock
  S->>DB: read the migrations table
  S->>S: verify checksums of applied ones
  S->>DB: run each pending up script
  S->>DB: record version, name, checksum
  S->>DB: COMMIT
  S->>DB: the same for framework_migrations
  S-->>C: the store, up to date
```

Two processes opening the same database at once apply each migration once. SQLite reads what is
pending while holding the write lock; Postgres and MySQL take a lock in the database (an advisory
lock, a named lock) for the whole batch, and the second process finds the first one's work done.

::: details Under the hood: running a script
A script runs one statement at a time, so a statement that fails fails the script with its own
error (run whole, SQLite reports only the last one's). The split leaves alone the semicolons in
strings, quoted names and comments, a SQLite trigger's body, and on Postgres dollar-quoted
bodies (`$$ … $$`). SQLite runs migrations with foreign keys off, so a table rebuilt the
documented way (new table, copy, drop, rename) keeps the rows that point at it, and then checks
`PRAGMA foreign_key_check` before committing. MySQL commits each change of structure on the
spot, with everything before it: a batch that fails after a `CREATE` or an `ALTER` keeps what
was committed then.
:::

### Checksums: never edit an applied migration

The store records the SHA-256 of each up script it applied (`migrationChecksum`, line ends
counted as `\n`). On every `up`, so on every `open`, it checks each applied one against the file
on disk. Change `00001_board_up.sql` after it ran, and boards refuses to open:

```text
Error: Migration 00001_board was changed after it was applied: put its up file back as it was, and make the change a new migration
```

The database did not run what the folder says, and newt will not guess which one is right.

::: danger Never
Never edit a migration that has been applied anywhere: on a colleague's machine, in CI, in
production. A change of shape is a new migration, `00008_<name>`, in **every** dialect's folder,
with the same number. Before a migration is shared, you may `down` it, change it, and `up` it
again; after, it is history.
:::

Two more mistakes the runner refuses rather than guesses at. Two files with the same number and
different names (two branches merged, each with its own `00008`) fail with "share the version:
renumber one". And a database whose last applied migration is no longer in the folder (you
checked out an older branch) fails with "is not in the migrations folder".

::: warning Watch out
Your backend may be running with `--watch`, applying migrations the moment a file appears. A
migration you are still writing may already be applied. Once it ran, even locally, treat it as
history and write the next one.
:::

### Migrating by hand

The server migrates as it opens, which is right in development. In production you often want
it apart: to see what a deploy will apply, to apply it from a command you are watching, or to
revert the last one. That is what `connect` is for: it opens the store as it is, migrating
nothing.

```ts
// cooper/scripts/migrations.ts
for (const context of contexts) {
  // `connect` opens the database as it is: `open` would migrate it first.
  const store = await connectStore(config[context].database, join(import.meta.dir, `../backend/contexts/${context}/migrations`))
  try {
    if (command === 'status') {
      const { applied, pending, changed } = await store.migrations.status()
      // …
    } else if (command === 'up') {
      const applied = await store.migrations.up()
      // …
    } else {
      const reverted = await store.migrations.down()
      // …
    }
  } finally {
    await store.close()
  }
}
```

`bun run cooper:migrations status` lists, for each context, what is applied and what is pending.
`status()` does not refuse a changed migration as `up` does: it is where you go to find out what
is wrong, so it names them in `changed`. `up()` applies the context's pending ones and then the
framework's, as `open` does. `down()` reverts the last one, and cooper's script asks for
`--context` before it does: reverting every context at once is never what you meant.

## The outbox, per store

When an event has a `handler` subscription, its job must be written in the same transaction as
the change that tells it ([Workers](./10-workers)). That only works if the jobs live in the same
storage as the data. So the outbox is part of the store, not a service beside it:

```ts
// packages/newt/port-outbox/outbox.ts
export interface Outbox {
  add(jobs: Job[]): Promise<void>
  claim(queues: string[], limit: number, worker: string, leaseUntil: string, now?: string): Promise<Job[]>
  renew(claimed: Job, leaseUntil: string): Promise<void>
  close(claimed: Job, closing: JobClosing): Promise<void>
  retry(id: string): Promise<boolean>
  // … seen, purge, list, get, waiting, depth, queues
}
```

Each adapter writes its own, on its own storage:

| Store | Outbox | Where the jobs are | How a claim is exclusive |
|---|---|---|---|
| SQLite | `SqliteOutbox` | `job`, `job_queue` tables | One `UPDATE … RETURNING` in a transaction that takes turns |
| Postgres | `SqlOutbox` | `job`, `job_queue` tables | `FOR UPDATE SKIP LOCKED` |
| MySQL | `SqlOutbox` | `job`, `job_queue` tables | `FOR UPDATE SKIP LOCKED`, then the update |
| Files | `FileOutbox` | `_jobs`, `_job_queues` collections | The store's one lock |

The worker, `JobQueue`, knows only the port. Each claim counts one more attempt and is fenced by
it (`isSameClaim`), so a worker whose lease ran out cannot close a job another worker has since
taken. `SKIP LOCKED` is what lets several instances on Postgres claim from one queue without
waiting on each other.

::: tip In cooper
The backoffice lists dead jobs and retries them through the outbox of each context: `retry(id)`
puts a dead job back to wait, as new. Its pages are in [Queues](./45-queues).
:::

## Moving from SQLite to Postgres

cooper made the move with three changes, and none of them is in a module.

**One: open by address.** `openStore` chooses the adapter by the address, as above. The modules
receive a `Store` and never ask which.

**Two: a second folder of migrations.** Every context gets `migrations/postgres/` beside
`migrations/sqlite/`, with the same pairs. Most twins differ only in collation; a few use the
types SQLite lacks:

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00005_activity_up.sql
CREATE TABLE activity (
  id TEXT COLLATE "C" PRIMARY KEY,
  -- …
  detail JSONB NOT NULL,
  -- …
  version INTEGER NOT NULL
);
```

The down files are usually word for word the same: a `DROP TABLE`.

**Three: a test against Postgres.** SQLite's tests prove the modules. They cannot prove the
migrations twins say the same thing, nor that a rule over several rows has its guard. So cooper
runs one test on a real Postgres when `COOPER_TEST_POSTGRES_URL` is set, and skips it otherwise:

```ts
// cooper/backend/postgres.test.ts
const url = process.env.COOPER_TEST_POSTGRES_URL

if (url) {
  describe('cooper on Postgres', () => {
    test('opens every context migrated, and works across them as on SQLite', async () => {
      const settings = await postgresConfig()
      const contexts = await openContexts(settings, { mailer: { send: async () => {} } })
      // …
      const roadmap = await board.create({ name: 'Roadmap' })
      await expect(board.create({ name: 'ROADMAP' })).rejects.toMatchObject({ code: 'board.name_taken' })
      const todo = await column.add(roadmap.id, { name: 'To do' })
      const cards = await Promise.all(['Plan', 'Design', 'Plan again'].map(title => card.create(roadmap.id, { columnId: todo.id, title })))
      expect(cards.map(each => each.number).toSorted()).toEqual([1, 2, 3])
      // …
    })
  })
}
```

Each context gets a fresh database of its own, `cooper_test_<context>`, dropped and made again:
the URL must be a role that may `CREATE DATABASE`, never one whose data matters. The three cards
created at once are the point: on Postgres they really do run side by side, and the guard on
the board's counter is what gives them 1, 2 and 3.

```mermaid
flowchart LR
  A["data/cooper-boards.db"] -->|"COOPER_BOARDS_DATABASE=postgres://…"| B["openStore"]
  B --> C["PostgresStore.open"]
  C --> D["migrations/postgres"]
  C --> E["framework: job, job_queue, schedule_tick"]
  B -.->|unchanged| F["modules, repositories, use cases"]
```

::: warning Watch out
The data does not move by itself. newt migrates structure, not rows between databases. Moving a
running SQLite context's rows to Postgres is a one-off export and import you write for your
data, with the server stopped.
:::

What changes in behaviour is what you want to change: saves run side by side, guards become
locks in the database, and claims skip each other. What does not change is everything your
modules say.

## Writing a store of your own

You will rarely need one. For another SQL database, start from `@newt-kit/newt/sql`: a new SQL adapter is
mostly a `SqlServerDialect` (how a parameter and a name are written, how `ieq` and "differs
from" are said, how a collision reads in its errors, how a key becomes a lock), as
`packages/newt/adapter-postgres/postgres-dialect.ts` is for Postgres. For something else
entirely, a key-value service or a store in memory for examples, you implement the port.

newt gives you the hardest parts as pieces:

- **`TransactionScope`** (`@newt-kit/newt/port-store`) is the machinery of transactions: the current one
  following the code in an `AsyncLocalStorage`, a call inside one joining it, a late call of one
  that ended failing instead of running outside it, `afterCommit` and `afterRollback`, the write
  rule's record of which modules each transaction saved, and the queue and the wait that gives
  up saying why. You hand its `run` your steps: `begin`, `commit`, `rollback`, and an optional
  `end`. A store whose transactions take turns (the default, `serial`) guards a key by being in
  a transaction; one whose transactions run side by side passes `serial: false` and takes a lock
  per key itself.
- **`noteRead(table)`** (`@newt-kit/newt/port-store`): your table calls it as it finds and counts, so the
  guard rule sees a save that reads rows without guarding them, on your store too.
- **`criteriaTree`, `matches`, `compare`** (`@newt-kit/newt/core`): criteria as a tree to translate into a
  query, or checked and sorted in memory for a store without one.
- **`isSameClaim`** (`@newt-kit/newt/port-outbox`): the rule that fences a claimed job.
- **`migrationName`, `migrationChecksum`** (`@newt-kit/newt/port-store`): name and fingerprint migrations
  as the other stores do.

```ts
import { TransactionScope, type Store } from '@newt-kit/newt/port-store'

export class MemoryStore implements Store {
  private readonly scope = new TransactionScope<Staged>()

  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const staged: Staged = new Map()
    return this.scope.run(fn, staged, {
      begin: () => {},
      commit: () => { /* put the staged copies in place of the committed tables */ },
      rollback: () => {},
    })
  }

  /** Its transactions run one at a time: a key is guarded by being in one. */
  guard(keys: string[]): Promise<void> {
    return this.scope.guard(keys)
  }
  // … afterCommit, afterRollback (the scope's), table, outbox, migrations, close
}
```

### Proving it: the contract suite

A store that compiles is not a store that keeps its promises. `@newt-kit/newt/port-store/contract` has the
suite every adapter of newt runs: transactions, isolation, guards, `afterCommit` and
`afterRollback`, tables and criteria, versions and unique values, repositories (scoped too), the
outbox, the job queue, and schedules on top.

```ts
// packages/newt/adapter-sqlite/sqlite-store.test.ts
import { describeStoreContract } from '@newt-kit/newt/port-store/contract'

describeStoreContract('SqliteStore', { open })
```

The fixture asks one thing, `open()`, and two promises of it. Each call gives a **fresh, empty
store**, which the suite closes. And a store whose structure is declared ahead (any SQL one) has
a `thing` table for `ThingRow`: every field a column in snake case, `name` unique among the rows
whose `deleted_at` is null, text sorted by code point. Writing that migration is your adapter's
job; `packages/newt/adapter-postgres/postgres-store.test.ts` shows one, and drops and makes its
`public` schema again before each test.

```mermaid
flowchart LR
  T["describeStoreContract"] --> A["a transaction"]
  T --> I["isolation"]
  T --> G["guard"]
  T --> TB["a table"]
  T --> R["a table repository"]
  T --> O["the outbox"]
  T --> J["the job queue"]
  T --> S["a schedule"]
```

::: tip In cooper
The same idea proves cooper's own ports: the card search has a contract suite that every
search adapter runs ([Queries, analytics and ports](./25-queries)). A port is proved by a suite,
not by one adapter's tests.
:::

The Postgres and MySQL suites run only when `FRAMEWORK_TEST_POSTGRES_URL` and
`FRAMEWORK_TEST_MYSQL_URL` are set, and they empty the database they are given before every
test. Give them one of their own.

## Recap

- A context keeps its data in one **store**, an adapter of the `Store` port. Repositories talk
  to the port and its **tables**, never to a database.
- Four adapters ship: `SqliteStore` (start here, and stay on one machine), `FileStore` (small
  data, no SQL), `PostgresStore` and `MySqlStore` (several instances, transactions side by
  side). Each opens with `open`, migrated, or `connect`, as it is.
- Rows are camel case, columns snake case; `types`, `unique` and, on SQL, `columns` describe a
  table the same way to every store.
- Migrations are `000NN_<name>_up.sql` and `_down.sql` pairs, **one folder per dialect**,
  applied at open, then the framework's own. Checksums make an applied migration history: a
  change is always a new migration, in every folder.
- The **outbox** lives in the store, so a job is written in the transaction of its change.
- Moving cooper to Postgres was an address, a second folder of migrations, and a test on a real
  database: no module changed.
- A store of your own builds on `TransactionScope` (or `@newt-kit/newt/sql` and a dialect) and is proved
  by `describeStoreContract`.

## Going further

- [Versions, conflicts and guards](./20-concurrency): how each store turns a guard into turns
  or locks, and why the guard rule fails on SQLite too.
- [Queries, analytics and ports](./25-queries): Kysely on the SQL stores, and contract suites for
  your own ports.
- [Doing things once](./24-idempotency): jobs that may run twice, from the outbox above.
- [Production](./13-production): opening every context, and migrating before a deploy.
- [Command line](./c-cli): `newt add module` reminds you to add a migration in each dialect's
  folder.
