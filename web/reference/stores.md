# Stores

Where a context keeps its data is a **store**: an object that implements the
`Store` port (`newt/port-store`). The framework only talks to that port, so a context
may keep its data in SQLite, in files, or anywhere an adapter can reach. Four adapters
come with the framework (SQLite, files, Postgres and MySQL); any other is a class you
write and check with the contract suite. Each of cooper's contexts keeps its data in a
SQLite file of its own.

## What a store promises

```ts
interface Store {
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
  afterCommit(fn: () => void): void
  afterRollback(fn: () => void): void
  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): Table<Row>
  guard(keys: string[]): Promise<void>
  readonly outbox: Outbox
  readonly migrations: Migrations
  close(): Promise<void>
}
```

- **A transaction is all or nothing.** What `transaction` writes, its outbox jobs
  included, is stored together or not at all, and one that resolves has committed. A
  call inside one joins it; writes side by side in it (a `Promise.all`) are each on
  their own, as one after another. A call of it that comes once it has committed or
  rolled back (left unawaited, or a branch of a `Promise.all` still running when
  another threw) fails, and runs nowhere: await every call inside a transaction.
- **The current transaction follows the code.** Whatever runs inside `fn`, however
  deep and across `await`s, reads and writes in it without being handed it. (The
  adapters keep it in an `AsyncLocalStorage`.)
- **Transactions that guard the same key never interleave.** A rule over several
  rows names what it guards (`guard(['boardName:<workspace>:<name>'])`, which a save does from its
  `guard` option); while one transaction holds a key, another that asks for it waits,
  so what the rule reads stays true until it commits. The rest run side by side, if
  the store can. SQLite and files run one transaction at a time, so they keep it
  already; Postgres and MySQL take a lock in the database for each key.
- **Reads outside a transaction see only what is committed.**
- **A stored row keeps its version**: a write that finds another, or a new row
  whose id or unique value is taken, throws `ConcurrencyConflict`.
- `afterCommit` runs a function once the transaction in progress commits; at once
  outside one; never if it rolls back. It is how events reach their `fire-and-forget`
  handlers only for what was saved. `afterRollback` runs one if it rolls back, the
  latest first; never on a commit, nor outside one: it is how a save puts its
  entities back as they were when what it wrote is undone.
- **A call waits its turn, but not forever**: 30 s by default (`waitTimeoutMs`),
  then it fails saying why. The usual cause is code inside a transaction that lost
  it (`AsyncLocalStorage.snapshot`, an `EventEmitter`) and asks for the store, so
  it waits for the very transaction it is part of. This holds where transactions
  take turns (SQLite, and files within one process; files wait 10 s for another
  process). On Postgres and MySQL `waitTimeoutMs` bounds a `guard`; code that lost
  its transaction waits on the database's own row locks instead (by default, for
  ever on Postgres and 50 s on MySQL, with the database's error). The contract suite does not
  check this promise.

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

Criteria nest in groups, `and` (every one) and `or` (at least one), and answer the
same in every store:
- a comparison with `null` holds for nothing: `{ eq: null }` and `{ ne: null }` are
  how to ask for it;
- `ne` means "different, a missing value included" (SQL's `IS DISTINCT FROM`, not
  `<>`): `{ ne: 'x' }` also matches the rows with no value;
- a `null` in an `in` list does match `null`;
- a server takes only so many values in one query (about 65 535 parameters on
  Postgres and MySQL): an `in` list that comes from a request is capped by its
  schema (`.max(500)`), or a long one fails as a 500;
- an operator left `undefined`, or a condition with none in it (`{}`), is no condition;
- `ieq` ignores the case of A to Z only, on every store: `Ñ` and `ñ` differ.
  Keep a lower-cased column for a search that must fold every letter;
- text sorts and compares (`gt`, `lt`…) by code point (UTF-8 byte order: `Bob`
  before `bea`, `z` before `é`), as `compare` does in memory, and a trailing space
  makes another value (on Postgres and MySQL, where the column's collation is binary:
  see below); null sorts first going up, last going down;
- a value with NUL (`\u0000`) matches only what holds it: nothing on Postgres, whose
  text cannot hold one (writing one there is a `ValidationError`, a 400).

A table is the common ground every store can offer. What a table cannot say (a
join, an aggregate, a full-text search) a repository asks its store's own API:
each adapter exposes one.

### The outbox

`outbox` keeps the jobs of `handler` subscriptions: written in the transaction of
the change that publishes them, then claimed, renewed and closed by the job worker,
each claim fenced by its attempt so a worker whose lease ran out cannot close a job
another one took. `retry(id)` puts a dead job back to wait, as new (cooper offers it,
with the list of dead jobs, as use cases of a small `Outbox_Module` in each context,
for its backoffice). `list()` and
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
be read is an error, never "no migrations". cooper's is `cooper/scripts/migrations.ts`
(`bun run cooper:migrations status|up|down [--context <name>]`):

```ts
// cooper/scripts/migrations.ts
// `connect` opens the database as it is: `open` would migrate it first.
const store = await SqliteStore.connect({
  path: config[context].dbPath,
  migrations: join(import.meta.dir, `../backend/contexts/${context}/migrations`),
})
```

## SQLite: `newt/adapter-sqlite`

```ts
// cooper/backend/contexts/boards/boards.context.ts
const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
```

`config.dbPath` is `data/cooper-boards.db` unless `COOPER_BOARDS_DB_PATH` says
otherwise; the tests give `:memory:`.

- **Transactions run one at a time**, in the order they ask, on a connection that
  writes. Reads outside them go to a second connection, read only, which sees only
  what is committed (WAL). A `:memory:` store is a temporary file, removed on
  `close`, so tests run with exactly the semantics of production. A transaction
  SQLite rolls back on its own (`RAISE(ROLLBACK)` in a trigger, a full disk) fails
  even if the code caught the error: nothing more runs in it, and nothing is stored.
- **`store.connection`** is the handle for anything a table cannot say: a
  `bun:sqlite` database whose statements run on the right connection when they run
  (a statement prepared outside a transaction and run inside one reads what the
  transaction wrote), and which refuses a write outside a transaction. Put a query
  builder on it if you want one, and use the store's transactions, never the
  builder's own: in a repository, `save` or `saveRows`; elsewhere,
  `store.transaction`. `kyselyFor(store)` from `newt/kysely` is that, ready made:

  ```ts
  // cooper/backend/contexts/boards/boards-base.ts
  export class BoardsBase extends CooperBase {
    readonly db = kyselyFor<BoardsDatabase>(this.store)
  }
  ```

  Its statements read and write in the transaction in progress.
- **`store.table(name, options)`** writes its own SQL. A field's column is its name
  in snake case unless `columns` says otherwise (a field must be in camel case for
  its column to name it back); `types` matters here: a boolean is kept as 0 or 1,
  JSON as text.
- **Migrations are SQL**: pairs of `000NN_<name>_up.sql` and `000NN_<name>_down.sql`
  in a folder, applied all or none; two with the same number are refused. A file
  runs one statement at a time, split as SQLite reads it (a trigger, with semicolons
  in its body, is one), and any statement that fails fails it. Migrations run with
  foreign keys off, so a table rebuilt as SQLite documents it (create the new one,
  copy, drop, rename) keeps the rows that point at it; one that leaves a row pointing
  nowhere fails (`PRAGMA foreign_key_check`). An entity's table has `id TEXT PRIMARY KEY` and
  `version INTEGER NOT NULL`; a unique value is a unique index (partial,
  `WHERE deleted_at IS NULL`, when rows are deleted softly). The framework's own
  tables (`job`, `job_queue`) are migrated after the context's.

## Postgres and MySQL: `newt/adapter-postgres`, `newt/adapter-mysql`

```ts
const store = await PostgresStore.open({ url: 'postgres://user:password@host:5432/boards', migrations: 'migrations' })
const store = await MySqlStore.open({ url: 'mysql://user:password@host:3306/boards?sslmode=require', migrations: 'migrations' })
```

- **On `Bun.SQL`**: no driver to install. A pool of connections (`connections`, 10 by
  default); each transaction reserves one until it ends, and reads outside one take
  any, seeing only what is committed.
- **Transactions run side by side**, as the database runs them, both at `READ
  COMMITTED` (MySQL's own is `REPEATABLE READ`: the store sets it for each
  transaction), so a read sees what was committed before it, and a rule read after its
  guard sees what the guard's last holder wrote. A key guarded is a lock in the
  database for the transaction (`pg_advisory_xact_lock`, `GET_LOCK`, named after the
  database and the key), so only transactions guarding the same key take turns; a
  guard waits `waitTimeoutMs` at most, and only the guard. The statements of one
  transaction take turns on its connection. A transaction the database gives
  up (a deadlock, a serialization failure) is a `ConcurrencyConflict`, which the use case
  runs again (unless it says `retryOnConflict: false`).
- **The same SQL tables as SQLite's**, written for each one: `store.table(name, { types })`
  translates criteria into the database's dialect, and `ieq` folds A to Z only here
  too. `store.query(sql, params)` runs a statement of one's own in the transaction in
  progress; Kysely runs on it as on SQLite. Unlike SQLite, a write outside a
  transaction is not refused: it runs at once, on its own. A `BIGINT` comes back as a
  number while it is exact (as text beyond 2^53), a `DECIMAL`/`NUMERIC` as text. A
  Postgres table learns its columns' types once, and again when a row brings a column
  it has not seen (one a migration added), and every time its store migrates: a
  column whose type or nullability another process changed is seen after a restart.
- **Migrations are SQL in the database's dialect**, the same file pairs as SQLite's.
  A batch runs in one transaction. Postgres applies it all or none. MySQL commits
  each change of structure (`CREATE`, `ALTER`, `DROP`…) at once, together with all
  the batch did before it: a batch of data statements only (`INSERT`, `UPDATE`…) is
  all or none; one that fails after a change of structure keeps what was committed
  then, the migrations before it recorded as applied, and the failed one's changes
  of structure, not recorded. Two processes that migrate at once take turns (an
  advisory lock, a named lock): the second finds the first's migrations applied.
  Two files with the same number and different names are an error. A file is split
  into statements on its semicolons, leaving out those in strings and quoted names
  (`'…'`, `"…"`, `` `…` ``, with `\` escapes on MySQL), in comments (`--`, `/* */`)
  and, on Postgres, in dollar-quoted bodies (`$$ … $$`), so a Postgres function or
  trigger goes in whole; a MySQL trigger is a single statement (`FOR EACH ROW SET
  …`), with no `BEGIN … END`.
- **Postgres**: an entity table has `id TEXT PRIMARY KEY` and `version INTEGER NOT
  NULL`; booleans are `BOOLEAN`, JSON is `JSONB`; a unique value among the rows not
  deleted is a partial unique index. Text columns are best `COLLATE "C"` (or a
  database created with `LC_COLLATE 'C'`), so they compare and sort by code point, as
  in the other stores: the usual locale sorts `Ana`, `bea`, `Bob`. A column is
  compared and sorted by its own collation, so its indexes serve. Null sorts as in
  the other stores (first going up): on a column that may hold it the table says
  `NULLS FIRST`/`NULLS LAST`, so an index meant to serve that ordering is declared
  the same (`CREATE INDEX … (assignee_id NULLS FIRST)`); a `NOT NULL` one (a primary key) is
  ordered plainly. A
  statement that fails inside a transaction spoils it in Postgres, so a write that
  may collide runs under a savepoint: a collision is a `ConcurrencyConflict` and the
  transaction goes on; a transaction spoiled by a statement of one's own that failed
  is rolled back, and fails, when it would commit.
- **MySQL** (8.4): `id VARCHAR(36) PRIMARY KEY`; text columns are best
  `utf8mb4_0900_bin`, so `=`, unique indexes and sorting treat case and a trailing
  space as the other stores do (`utf8mb4_bin` pads: `'ana' = 'ana '`); booleans are
  0 and 1, JSON is `JSON` (a json field lives in a `JSON` column: from one of text it
  reads back as its text); a unique value among the rows not deleted is a functional
  unique index on `(IF(deleted_at IS NULL, col, NULL))`. A change of structure
  (`CREATE`, `ALTER`, `DROP`…) inside any transaction, not only a migration's, commits
  it there and then: what comes after it runs on its own, outside it, and a rollback
  undoes none of it. MySQL 8.4 signs in over TLS
  only: a URL without `?sslmode=require` fails with
  `ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED`.
- Their tests run the contract suite against real databases when
  `FRAMEWORK_TEST_POSTGRES_URL` and `FRAMEWORK_TEST_MYSQL_URL` are set, and are
  skipped otherwise. They empty the database the URL names before each test (the
  `public` schema on Postgres, the whole database on MySQL): give them one of their
  own, and run one suite on it at a time.

## Kysely: `newt/kysely`

`kyselyFor<Database>(store)` gives Kysely on any SQL store (SQLite, Postgres,
MySQL): its statements run on the store's connections, in the transaction in
progress, and field names are the rows' (`workspaceId`), turned into the columns'
(`workspace_id`) on their way. Kysely's own transactions are refused: they would not be
the store's. A boolean comes back as 0 or 1 on SQLite and MySQL, and JSON as text
on SQLite: `SqliteRow<Row>` says so in the types. A JSON column on Postgres takes
the value itself (`tags: []`): its JSON text would be stored as a string. A sum comes back as text on
Postgres and MySQL, and a `COUNT` on Postgres: pass them through `Number(…)`. On
Postgres and MySQL the store gives Kysely back only rows, so a write's
`numUpdatedRows` and `numDeletedRows` are `0n` and there is no `insertId`: use
`returning` (Postgres) or read again. Kysely is an optional peer dependency.

## Files: `newt/adapter-files`

```ts
const store = await FileStore.open({ folder: 'data/boards', migrations: [/* FileMigration */] })
```

- **One JSON file per record**, one folder per collection:
  `data/boards/card/<id>.json`. They are read and written on the disk as they are,
  never kept in memory. An id is up to 100 letters, numbers, `.`, `-` and `_`,
  starting with a letter or a number (a collection's name, up to 100 letters,
  numbers, `-` and `_`): a write of any other is refused, a read finds nothing.
- **Transactions are its own.** What one writes waits in memory, where it reads it
  back, and goes to the disk on commit through a journal: every write goes to
  `_journal.json`, flushed to the disk (that is the commit); then each record is
  written whole, over the one before; then the journal goes. A crash before the
  journal leaves nothing; after it, whoever takes the lock next writes it all again.
- **One lock, `_lock`, for everything**: one transaction or read at a time, in this
  process and across processes sharing the folder. The lock says which process took
  it, and its holder touches it every second while it holds it. One is left behind,
  and taken over, when the process it names is not alive, or when it has not been
  touched for 5 s whatever it names (a restart gave its process id to another
  process). The processes must see each other's ids: one host, one process
  namespace, not two containers. A holder whose process stops for 5 s (a long
  synchronous step, a GC pause, SIGSTOP, a suspended machine) is taken over like
  that too, so every file a commit writes, the journal first, is renamed into place
  only after checking, at once, that the lock still holds its own token: a
  transaction taken over before its journal is in fails with a
  `ConcurrencyConflict` and writes nothing (a use case runs again); one taken over
  after it leaves its records to the new holder, which finishes the journal first.
  A transaction that only read fails the same way: what it read may mix two; a read
  outside a transaction reads again instead. What is left is a process stopped for
  5 s right inside that check and rename.
- **Once the journal is on the disk the transaction is committed**, even if writing
  the records fails: the next one to take the lock writes them. Until then every
  call fails, saying why: what it read would miss that transaction. Mend what the
  disk refused (space, permissions) and the store goes on.
- **`store.collection(name)`** is the handle for what a table cannot say: `get`,
  `all`, `put`, `remove`, in the transaction in progress.
- **`store.table(name, { unique })`** finds rows by reading the whole collection.
  `unique` matters here: it is the only thing that keeps two rows from sharing a
  value.
- **Migrations are functions** that transform records, run in a transaction:

  ```ts
  const assignee: FileMigration = {
    version: 2,
    name: 'card-assignee',
    up: async store => {
      const cards = store.collection('card')
      for (const card of await cards.all()) await cards.put({ ...card, assigneeId: null })
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
  the code, a call inside one joining it, a late call of one that ended failing
  instead of running outside it, `afterCommit` and `afterRollback`, and, for a store
  whose transactions take turns (`serial`, the default), the queue and the wait that
  gives up saying why. An adapter gives it its steps (`begin`, `commit`, `rollback`, `end`) and builds on it,
  as every adapter here does.
- `criteriaTree(criteria)` turns criteria into a tree (`all`, `any`, a condition on
  a field) to translate into a query; `matches(row, criteria)` and `compare(a, b)`
  check and sort rows in memory, for a store without a query language. A SQL store
  can reuse the framework's whole SQL table by giving its dialect, as Postgres and
  MySQL do.
- `isSameClaim(stored, claimed)` is the rule that fences a claimed job.
- `migrationName(version, name)` names a migration as the others do.

Then it runs the contract suite, which checks the promises above (all but the
bounded wait), the repositories and the job queue on it. Its fixture (`StoreFixture`)
asks two things of `open`: a fresh, empty store each time, and a `thing` table for
`ThingRow` (each field a column in snake case, `name` unique among the rows not
deleted):

```ts
import { describeStoreContract } from 'newt/port-store/contract'

describeStoreContract('PostgresStore', {
  open: async () => {
    await emptyTheTestDatabase()   // a database of the tests' own, emptied each time
    return PostgresStore.open({ url: process.env.TEST_DATABASE_URL!, migrations: 'test/migrations' })
  },
})
```

The `thing` migration is the adapter's to write: see
`packages/newt/adapter-postgres/postgres-store.test.ts`.

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
`describeAnalyticsContract` checks one written for ClickHouse or DuckDB. cooper
writes a small one on SQLite, `shared/analytics/sqlite-analytics.ts`, its SQL kept in
that one file and marked as SQLite's. DuckDB can
also read a context's SQLite file as it is, for reports, without copying it.
