# Stores

Where a context keeps its data is a **store**: an object that implements the
`Store` port. The framework only talks to that port, so a context may keep its
data in SQLite, in files, or anywhere an adapter can reach. Four adapters come with
the framework (SQLite, files, Postgres and MySQL); any other is a class you write and
check with the contract suite.

## What a store promises

```ts
interface Store {
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
  afterCommit(fn: () => void): void
  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): Table<Row>
  guard(keys: string[]): Promise<void>
  readonly outbox: Outbox
  readonly migrations: Migrations
  close(): Promise<void>
}
```

- **A transaction is all or nothing.** What `transaction` writes, its outbox jobs
  included, is stored together or not at all. A call inside one joins it.
- **The current transaction follows the code.** Whatever runs inside `fn`, however
  deep and across `await`s, reads and writes in it without being handed it. (The
  adapters keep it in an `AsyncLocalStorage`.)
- **Transactions that guard the same key never interleave.** A rule over several
  rows names what it guards (`guard(['stock:<id>'])`, which a save does from its
  `guard` option); while one transaction holds a key, another that asks for it waits,
  so what the rule reads stays true until it commits. The rest run side by side, if
  the store can. SQLite and files run one transaction at a time, so they keep it
  already; Postgres and MySQL take a lock in the database for each key.
- **Reads outside a transaction see only what is committed.**
- **A stored row keeps its version**: a write that finds another, or a new row
  whose id or unique value is taken, throws `ConcurrencyConflict`.
- `afterCommit` runs a function once the transaction in progress commits; at once
  outside one; never if it rolls back. It is how events reach their `fireAndForget`
  handlers only for what was saved, and how entities learn they were saved.
- **A call waits its turn, but not forever**: 30 s by default (`waitTimeoutMs`),
  then it fails saying why. The usual cause is code inside a transaction that lost
  it (`AsyncLocalStorage.snapshot`, an `EventEmitter`) and asks for the store, so
  it waits for the very transaction it is part of.

### Tables and criteria

`table(name)` is what `TableRepository` works on: rows with an `id` and a `version`,
found by criteria and written with their version checked.

```ts
interface Table<Row extends StoredRow> {
  find(criteria?: Criteria<Row>, options?: { orderBy?, limit? }): Promise<Row[]>
  count(criteria?: Criteria<Row>): Promise<number>
  insert(row: NewRow<Row>): Promise<void>                                   // stored with version 1
  update(id: string, version: number, changes: Partial<NewRow<Row>>): Promise<void>  // one version on
  patch(id: string, changes: Partial<NewRow<Row>>): Promise<void>           // whatever its version
  delete(id: string, version: number): Promise<void>
}
```

A table is described in the same words to every store, so a repository moves from
one store to another unchanged: `types` names the fields a store may not keep as
they are (`boolean`, and `json` for objects and lists), and `unique` the fields no
two rows share (a row deleted softly aside). A store that does not need one ignores
it: SQLite's unique values are its indexes; files keep booleans as they are.

Criteria nest in groups, `and` (every one) and `or` (at least one), and answer what
SQL would, in every store: a comparison with `null` holds for
nothing (`{ eq: null }` and `{ ne: null }` are how to ask for it), a `null` in an
`in` list does match `null`, an operator left `undefined` is no condition, and
`ieq` ignores the case of A to Z only, as SQL's `lower()` does: `Ñ` and `ñ` differ.
Keep a lower-cased column for a search that must fold every letter.

A table is the common ground every store can offer. What a table cannot say (a
join, an aggregate, a full-text search) a repository asks its store's own API:
each adapter exposes one.

### The outbox

`outbox` keeps the jobs of `handler` subscriptions: written in the transaction of
the change that publishes them, then claimed, renewed and closed by the job worker,
each claim fenced by its attempt so a worker whose lease ran out cannot close a job
another one took. `retry(id)` puts a dead job back to wait, as new. `list()` and
`queues()` show what it holds; `waiting()` counts the jobs still to run of each
queue, which the worker reads every minute to warn about a queue nobody serves, so
it should not read the jobs done nor their payloads (the files store, which reads
whole collections, does).

### Migrations

`migrations` applies the changes to the store's structure, in order, and remembers
them: `up()`, `down()`, `status()`. Each adapter decides what a migration is.
Opening a store with `open` applies the pending ones; `connect` opens it as it is,
for the scripts that migrate it by hand, whose `up()` applies the store's own and
then the framework's (its outbox), as `open` does. A migrations folder that cannot
be read is an error, never "no migrations".

## SQLite: `newt/adapter-sqlite`

```ts
const store = await SqliteStore.open({ path: 'data/shop.db', migrations: 'migrations' })
```

- **Transactions run one at a time**, in the order they ask, on a connection that
  writes. Reads outside them go to a second connection, read only, which sees only
  what is committed (WAL). A `:memory:` store is a temporary file, removed on
  `close`, so tests run with exactly the semantics of production.
- **`store.connection`** is the handle for anything a table cannot say: a
  `bun:sqlite` database whose statements run on the right connection when they run
  (a statement prepared outside a transaction and run inside one reads what the
  transaction wrote), and which refuses a write outside a transaction. Put a query
  builder on it if you want one, and use the store's transactions, never the
  builder's own: in a repository, `save` or `saveRows`; elsewhere,
  `store.transaction`. `kyselyFor(store)` from `newt/kysely` is that, ready made:

  ```ts
  class AppBase extends Base<SqliteStore> {
    readonly db = kyselyFor<AppDatabase>(this.store)   // reads and writes in the transaction in progress
  }
  ```
- **`store.table(name, options)`** writes its own SQL. A field's column is its name
  in snake case unless `columns` says otherwise (a field must be in camel case for
  its column to name it back); `types` matters here: a boolean is kept as 0 or 1,
  JSON as text.
- **Migrations are SQL**: pairs of `000NN_<name>_up.sql` and `000NN_<name>_down.sql`
  in a folder, applied all or none. A file is run whole, so a trigger, with
  semicolons in its body, goes in one. An entity's table has `id TEXT PRIMARY KEY` and
  `version INTEGER NOT NULL`; a unique value is a unique index (partial,
  `WHERE deleted_at IS NULL`, when rows are deleted softly). The framework's own
  tables (`job`, `job_queue`) are migrated after the context's.

## Postgres and MySQL: `newt/adapter-postgres`, `newt/adapter-mysql`

```ts
const store = await PostgresStore.open({ url: 'postgres://user:password@host:5432/shop', migrations: 'migrations' })
const store = await MySqlStore.open({ url: 'mysql://user:password@host:3306/shop?sslmode=require', migrations: 'migrations' })
```

- **On `Bun.SQL`**: no driver to install. A pool of connections (`connections`, 10 by
  default); each transaction reserves one until it ends, and reads outside one take
  any, seeing only what is committed.
- **Transactions run side by side**, as the database runs them. A key guarded is a
  lock in the database for the transaction (`pg_advisory_xact_lock`, `GET_LOCK`), so
  only transactions guarding the same key take turns. A transaction the database gives
  up (a deadlock, a serialization failure) is a `ConcurrencyConflict`, which the use case
  runs again (unless it says `retryOnConflict: false`).
- **The same SQL tables as SQLite's**, written for each one: `store.table(name, { types })`
  translates criteria into the database's dialect, and `ieq` folds A to Z only here
  too. `store.query(sql, params)` runs a statement of one's own in the transaction in
  progress; Kysely runs on it as on SQLite. Unlike SQLite, a write outside a
  transaction is not refused: it runs at once, on its own.
- **Migrations are SQL in the database's dialect**, the same file pairs as SQLite's.
  Postgres applies a batch all or none; MySQL commits a change of structure at once,
  so a batch that fails halfway keeps what it did. A file is split into statements
  on its semicolons, leaving out those in `'…'` strings, in `--` comments and, on
  Postgres, in dollar-quoted bodies (`$$ … $$`), so a Postgres function or trigger
  goes in whole; a MySQL trigger is a single statement (`FOR EACH ROW SET …`), with
  no `BEGIN … END`.
- **Postgres**: an entity table has `id TEXT PRIMARY KEY` and `version INTEGER NOT
  NULL`; booleans are `BOOLEAN`, JSON is `JSONB`; a unique value among the rows not
  deleted is a partial unique index. A statement that fails inside a transaction
  spoils it in Postgres, so a write that may collide runs under a savepoint: a
  collision is a `ConcurrencyConflict` and the transaction goes on.
- **MySQL** (8.4): `id VARCHAR(36) PRIMARY KEY`; text columns are best
  `utf8mb4_bin`, so `=` and sorting treat case as the other stores do; booleans are
  0 and 1, JSON is `JSON`; a unique value among the rows not deleted is a functional
  unique index on `(IF(deleted_at IS NULL, col, NULL))`. MySQL 8.4 signs in over TLS
  only: a URL without `?sslmode=require` fails with
  `ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED`.
- Their tests run the contract suite against real databases when
  `FRAMEWORK_TEST_POSTGRES_URL` and `FRAMEWORK_TEST_MYSQL_URL` are set, and are
  skipped otherwise.

## Kysely: `newt/kysely`

`kyselyFor<Database>(store)` gives Kysely on any SQL store (SQLite, Postgres,
MySQL): its statements run on the store's connections, in the transaction in
progress, and field names are the rows' (`productId`), turned into the columns'
(`product_id`) on their way. Kysely's own transactions are refused: they would not be
the store's. On SQLite a boolean comes back as 0 or 1 and JSON as text:
`SqliteRow<Row>` says so in the types. On Postgres and MySQL the store gives Kysely
back only rows, so a write's `numUpdatedRows` and `numDeletedRows` are `0n` and there is
no `insertId`: use `returning` (Postgres) or read again. Kysely is an optional peer
dependency.

## Files: `newt/adapter-files`

```ts
const store = await FileStore.open({ folder: 'data/notes', migrations: [/* FileMigration */] })
```

- **One JSON file per record**, one folder per collection:
  `data/notes/note/<id>.json`. They are read and written on the disk as they are,
  never kept in memory.
- **Transactions are its own.** What one writes waits in memory, where it reads it
  back, and goes to the disk on commit through a journal: every write goes to
  `_journal.json`, flushed to the disk (that is the commit); then each record is
  written whole, over the one before; then the journal goes. A crash before the
  journal leaves nothing; after it, whoever takes the lock next writes it all again.
- **One lock, `_lock`, for everything**: one transaction or read at a time, in this
  process and across processes sharing the folder. The lock says which process took
  it; one left by a process that died, or by an earlier life of this one (a
  container restarts with the same process id), is taken over. The processes must
  see each other's ids: one host, one process namespace, not two containers.
- **Once the journal is on the disk the transaction is committed**, even if writing
  the records fails: the next one to take the lock writes them.
- **`store.collection(name)`** is the handle for what a table cannot say: `get`,
  `all`, `put`, `remove`, in the transaction in progress.
- **`store.table(name, { unique })`** finds rows by reading the whole collection.
  `unique` matters here: it is the only thing that keeps two rows from sharing a
  value.
- **Migrations are functions** that transform records, run in a transaction:

  ```ts
  const archived: FileMigration = {
    version: 2,
    name: 'note-archived',
    up: async store => {
      const notes = store.collection('note')
      for (const note of await notes.all()) await notes.put({ ...note, archived: false })
    },
    down: async store => { /* undo it */ },
  }
  ```
- **It is for thousands of records, not millions**: every find reads a whole
  collection. For prototypes, tests, small tools, settings.

## Writing a store

A store for another database is a class that implements `Store`, with a `Table`,
an `Outbox` and `Migrations` of its own. The framework helps with the parts every
adapter shares:

- `TransactionScope` is the machinery of transactions: the current one following
  the code, a call inside one joining it, a late write running after it instead of
  being lost, `afterCommit`, and, for a store whose transactions take turns
  (`serial`, the default), the queue and the wait that gives up saying why. An
  adapter gives it its steps (`begin`, `commit`, `rollback`, `end`) and builds on it,
  as every adapter here does.
- `criteriaTree(criteria)` turns criteria into a tree (`all`, `any`, a condition on
  a field) to translate into a query; `matches(row, criteria)` and `compare(a, b)`
  check and sort rows in memory, for a store without a query language. A SQL store
  can reuse the framework's whole SQL table by giving its dialect, as Postgres and
  MySQL do.
- `isSameClaim(stored, claimed)` is the rule that fences a claimed job.
- `migrationName(version, name)` names a migration as the others do.

Then it runs the contract suite, which checks every promise above, the
repositories and the job queue on it:

```ts
import { describeStoreContract } from 'newt/port-store/contract'

describeStoreContract('PostgresStore', {
  open: () => PostgresStore.open({ url: process.env.TEST_DATABASE_URL!, migrations: 'test/migrations' }),
})
```

Two promises deserve care in a database with concurrent transactions:

- **Guards.** "Transactions that guard the same key never interleave" needs a lock
  per key, held until the transaction ends (an advisory lock), or transactions that
  run one at a time. Without it a rule checked in an `after` hook breaks without a
  sound; the suite has a test for it. A transaction the database gives up (a deadlock,
  Postgres's `40001`) is a `ConcurrencyConflict`, which the use case runs again.
- **The current transaction.** Keep it in an `AsyncLocalStorage`, as every adapter here
  does: a repository, a table and the outbox must all write in the same one without
  being handed it.

## Storage without transactions

Some places cannot keep a change and its jobs together: an analytics database
(ClickHouse, DuckDB), an object store, an outside API. They are not stores, and need
not be: a module may keep **projections** there, written by a `handler` worker that
follows the events of a store that has transactions. The job runs again until it
succeeds, so the handler writes in a way that is safe to repeat (an upsert by id, a
write keyed by the event).

For analytics the framework has a port of its own, `Analytics`: `append(dataset,
rows)`, only ever adding, each row with an id of its own so a repeated job never
duplicates it; reading is each adapter's own language. No adapter comes yet:
`MemoryAnalytics` is for tests and as the plainest example, and
`describeAnalyticsContract` checks one written for ClickHouse or DuckDB. DuckDB can
also read a context's SQLite file as it is, for reports, without copying it.
