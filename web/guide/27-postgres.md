# Postgres, MySQL and migrations in production

cooper runs on SQLite: one file per context, nothing to install, transactions one at a
time. That carries a single machine a long way. It stops when you want two servers on
the same data, or a database someone else runs and backs up for you. Then each context
needs a database server.

In this chapter each context learns to open Postgres when its address says so, and
SQLite otherwise. Look at what changes: one function that opens a store, a second set
of migrations, and a script that runs them by hand. Look also at what does not change:
no module, no repository, no use case, no route, no test of the earlier chapters.

What you add:

```text
cooper/
  backend/
    config.ts                         changed: COOPER_<CTX>_DATABASE may be a Postgres address
    shared/
      open-store.ts                   new: openStore and connectStore
      cooper-base.ts                  changed: Base<CooperStore>
      analytics/sql-analytics.ts      changed: reads a JSON field on either database
      analytics/migrations/postgres/  new
      web-session/migrations/postgres/ new
    contexts/
      auth/auth.context.ts            changed: openStore
      auth/migrations/postgres/       new
      boards/boards.context.ts        changed: openStore
      boards/boards-base.ts           changed: its doc
      boards/migrations/postgres/     new
      backoffice/backoffice.context.ts changed: openStore
      backoffice/migrations/postgres/ new
    postgres.test.ts                  new: skipped without COOPER_TEST_POSTGRES_URL
  scripts/
    migrations.ts                     new: bun run cooper:migrations
package.json                          changed: cooper:migrations
```

## The store is a port, again

Chapter [5](./05-sqlite) moved boards from files to SQLite and changed no module.
Every repository talks to `base.store.table<Row>(name)`, newt's table port, and a
`SqliteStore` answers it as a `FileStore` did. A `PostgresStore`, from
`newt/adapter-postgres`, answers it too: the same `find`, `count`, `page` and saves,
the same criteria, the same transactions and versions. Kysely (chapter
[15](./15-kysely)) runs on it as on SQLite, through `kyselyFor(store)`.

So the choice is still made in one place, the context's `open`. What is new is that
cooper makes it at run time, from the context's database address. That is one
function, in `shared/`:

```ts
// cooper/backend/shared/open-store.ts
import { join } from 'node:path'
import { PostgresStore } from 'newt/adapter-postgres'
import { SqliteStore } from 'newt/adapter-sqlite'

/** A store cooper runs on: SQLite, or Postgres. */
export type CooperStore = SqliteStore | PostgresStore

/** Whether a context's database is a Postgres server, by its address. */
const isPostgres = (database: string) => /^postgres(ql)?:\/\//.test(database)

/**
 * A context's store, by where its database is (`COOPER_<CONTEXT>_DATABASE`): a
 * `postgres://` address is Postgres, with the context's `migrations/postgres`; anything
 * else is a SQLite file (or `:memory:`), with its `migrations/sqlite`. Brought up to
 * date as it opens. MySQL would be one more line: `MySqlStore`, and its own folder.
 */
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

- **`openStore`** opens the store and brings it up to date: it applies the migrations
  it has not run yet, in order, before any module reads it. Each adapter has its own
  `open`: `SqliteStore.open({ path, migrations })`,
  `PostgresStore.open({ url, migrations })`.
- **`connectStore`** opens the same store as it is, migrating nothing. Only the
  migrations script below uses it.
- The context passes its `migrations` folder; `openStore` adds the subfolder of the
  database's dialect. That is why, since chapter 5, cooper has kept SQLite's migrations under
  `migrations/sqlite`.

`PostgresStore` is built on `Bun.SQL`: there is no driver to install. It keeps a pool
of connections (`connections`, 10 by default); each transaction holds one until it
ends.

`CooperStore` is the type every module's base now carries. Change `CooperBase` to
use it:

```ts
// cooper/backend/shared/cooper-base.ts
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import type { CooperStore } from './open-store'
import './actor'

/**
 * What every module of cooper receives: newt's base, on SQLite or Postgres, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<CooperStore> {
  readonly http = new HttpRouter()
}
```

boards' base says why it is a SQL store; its doc now names Postgres:

```ts
// cooper/backend/contexts/boards/boards-base.ts
/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (cards counted by workspace and by board). Kysely
 * needs a SQL store: `boards` opens on SQLite or Postgres, and would open on MySQL the
 * same way, never on files.
 */
```

### Each context opens through it

Each context's `open` called `SqliteStore.open` with its `migrations/sqlite` folder.
It now calls `openStore` with its `migrations` folder. In `boards.context.ts`, replace
the `SqliteStore` import with `openStore`'s, and the line that opened the store (and
the comment above it, which `openStore`'s doc now says):

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import type { Clock } from 'newt/core'
import { openStore } from '../../shared/open-store'
import { ServedContext } from '../../shared/served-context'
// …
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, clock?: Clock): Promise<Boards_Context> {
    const store = await openStore(config.database, join(import.meta.dir, 'migrations'))
    const base = new BoardsBase({ name: 'boards', store, clock })
```

The same in auth:

```ts
// cooper/backend/contexts/auth/auth.context.ts
import { join } from 'node:path'
import type { Clock } from 'newt/core'
import { openStore } from '../../shared/open-store'
import { ServedContext } from '../../shared/served-context'
// …
  static async open(config: Auth_Config, deps: Auth_ModuleDeps, clock?: Clock): Promise<Auth_Context> {
    const store = await openStore(config.database, join(import.meta.dir, 'migrations'))
    const base = new AuthBase({ name: 'auth', store, clock })
```

And in the backoffice:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.ts
import { join } from 'node:path'
import type { Clock } from 'newt/core'
import { CooperBase } from '../../shared/cooper-base'
import { openStore } from '../../shared/open-store'
import { ServedContext } from '../../shared/served-context'
// …
  static async open(config: Backoffice_Config, deps: Backoffice_ModuleDeps, clock?: Clock): Promise<Backoffice_Context> {
    const store = await openStore(config.database, join(import.meta.dir, 'migrations'))
    const base = new CooperBase({ name: 'backoffice', store, clock })
```

### The address comes from the settings

`COOPER_<CONTEXT>_DATABASE` was a SQLite file, relative to the repository's root. It
may now be a Postgres address too, which must not be turned into a path. Add the
`database` helper to `config.ts`, after `fromRoot`:

```ts
// cooper/backend/config.ts
/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

/**
 * A context's database from the environment: a Postgres address
 * (`postgres://user:password@host:5432/db`) as it is, or a SQLite file, relative to
 * the repository root.
 */
const database = (value: string) => (/^postgres(ql)?:\/\//.test(value) ? value : fromRoot(value))
```

and use it, with its doc, for each of the three contexts:

```ts
// cooper/backend/config.ts
// …
    /** `COOPER_AUTH_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_AUTH_DATABASE ?? 'data/cooper-auth.db'),
// …
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
// …
    /** `COOPER_BACKOFFICE_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_BACKOFFICE_DATABASE ?? 'data/cooper-backoffice.db'),
```

Each context chooses on its own. auth may run on Postgres while boards stays on a
SQLite file: they share no database, as they never did.

## Migrations per dialect

A migration is SQL, and SQL is a dialect. So each database gets its own folder of the
same file pairs, `000NN_<name>_up.sql` and `000NN_<name>_down.sql`, with the same
numbers and names: `migrations/sqlite/00001_board_up.sql` and
`migrations/postgres/00001_board_up.sql` are the same change, each in its own words.
The store applies the ones of its folder, in order, and remembers them, as SQLite's
did.

On Postgres, a migration batch runs in one transaction: it is applied all or none.
Two processes that migrate at once take turns (an advisory lock), and the second
finds the first's migrations applied.

### What differs

Most of a twin is the SQLite file with three kinds of changes:

- **Text is `TEXT COLLATE "C"`.** SQLite compares and sorts text by code point. A
  Postgres database usually compares by a language's rules, where `Ana`, `bea`, `Bob`
  is the order. `COLLATE "C"` makes each text column compare as on SQLite (and as the
  other stores do), and its indexes serve that order. Without it, the same page of
  boards would come back in a different order on each database.
- **Booleans are `BOOLEAN`.** SQLite keeps a boolean as `INTEGER`, 0 or 1. Postgres
  has the type, and the table reads and writes it as `true` and `false`.
- **JSON is `JSONB`.** SQLite keeps JSON as `TEXT`. Postgres has a JSON type.

The rest is the same SQL: the tables, the partial unique indexes
(`WHERE deleted_at IS NULL`), `lower(name)` for a name unique whatever its case. Where
SQLite has a function Postgres does not, the twin uses the standard one
(`coalesce` for `ifnull`).

### boards' migrations

boards' first migration, with every text column `COLLATE "C"`. The comment on the
index says why `lower` still folds only A to Z, as `ieq` does: it is `lower` of a
`"C"` column.

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00001_board_up.sql
-- Each workspace's boards. Like every row of boards', it says its workspace (an auth
-- tenant), by id and without a foreign key: the workspace is another context's, and
-- the repositories see only the rows of the current one.

-- An archived board keeps its row (`deleted_at` set): its name is free again.
CREATE TABLE board (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  description TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  deleted_at TEXT COLLATE "C",
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z: `lower` of a "C" column, as `ieq` compares).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

Its columns, its cards and counters, and the idempotency keys of chapter
[9](./09-idempotent-posts) change only in their collation:

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00002_column_up.sql
-- Each board's columns, from the left.
-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX column_board ON "column" (workspace_id, board_id, position);
```

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00003_card_up.sql
-- A card points at its board, its column and the member it is assigned to by id: the
-- column is another module's, the member another context's.
CREATE TABLE card (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  column_id TEXT COLLATE "C" NOT NULL,
  number INTEGER NOT NULL,
  title TEXT COLLATE "C" NOT NULL,
  description TEXT COLLATE "C" NOT NULL,
  assignee_id TEXT COLLATE "C",
  position INTEGER NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
CREATE INDEX card_column ON card (workspace_id, column_id, position);
CREATE INDEX card_assignee ON card (workspace_id, assignee_id);

-- The last number each board gave a card, so a deleted card's number is never given
-- again: cards are deleted for good, and the highest one left is not the last one
-- given. Its id is the board's.
CREATE TABLE card_counter (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);
```

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00004_idempotency_key_up.sql
-- The first answer to each POST sent with an `Idempotency-Key`, as newt/http keeps it
-- (`KeptAnswer`): its id is the key's hash, with who sent it and where, and the
-- hash of the body it answered. The index is how the forgotten ones are removed.
CREATE TABLE idempotency_key (
  id TEXT COLLATE "C" PRIMARY KEY,
  version INTEGER NOT NULL,
  body_hash TEXT COLLATE "C" NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT COLLATE "C" NOT NULL,
  body TEXT COLLATE "C" NOT NULL,
  expires_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);
```

The activity of chapter [11](./11-reacting) keeps each change's `detail` as JSON, so
on Postgres it is `JSONB`:

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00005_activity_up.sql
-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  card_id TEXT COLLATE "C" NOT NULL,
  kind TEXT COLLATE "C" NOT NULL,
  actor_id TEXT COLLATE "C",
  via TEXT COLLATE "C",
  at TEXT COLLATE "C" NOT NULL,
  detail JSONB NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
-- A card's activity, the newest first (ids are v7: in the order they were told).
CREATE INDEX activity_card ON activity (workspace_id, card_id, id);
```

And the web sessions' table, which boards copied from `shared/web-session` in chapter
[22](./22-web-session):

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00006_session_up.sql
-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT COLLATE "C" PRIMARY KEY,
  user_id TEXT COLLATE "C" NOT NULL,
  token_hash TEXT COLLATE "C" NOT NULL UNIQUE,
  expires_at TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user_id ON session (user_id);
```

Every down file is the same as SQLite's, word for word: a `DROP TABLE` (two, in
reverse order, for `00003_card`). Copy them:

```sh
for f in cooper/backend/contexts/boards/migrations/sqlite/*_down.sql; do
  cp "$f" cooper/backend/contexts/boards/migrations/postgres/
done
```

### The other contexts' migrations

auth's nine, the backoffice's two, and the two shared ones (web sessions, analytics)
are the same work, line by line: copy them from the checkpoint.

```sh
git checkout tutorial/27 -- \
  cooper/backend/contexts/auth/migrations/postgres \
  cooper/backend/contexts/backoffice/migrations/postgres \
  cooper/backend/shared/web-session/migrations/postgres \
  cooper/backend/shared/analytics/migrations/postgres
```

Read the three places where they are more than a collation. An OAuth client's redirect
URIs are a JSON list:

```sql
-- cooper/backend/contexts/auth/migrations/postgres/00007_oauth-client_up.sql
-- …
  redirect_uris JSONB NOT NULL,
-- …
```

A grant says whether its client is first party:

```sql
-- cooper/backend/contexts/auth/migrations/postgres/00008_oauth-grant_up.sql
-- …
  first_party BOOLEAN NOT NULL,
-- …
```

And an access is unique per person, product and tenant, with a null tenant counted
as a value:

```sql
-- cooper/backend/contexts/auth/migrations/postgres/00005_access-once_up.sql
-- One access per person, product and tenant: two saves giving the same one at once
-- cannot both succeed. A null tenant (the whole product) counts as a value, so the
-- staff's access is kept once too.
CREATE UNIQUE INDEX access_once ON access (user_id, product_id, coalesce(tenant_id, ''));
```

### Checksums, on both

Chapter [5](./05-sqlite) said it: an applied migration never changes. Postgres keeps it
the same way. The store records a checksum of each up file it applied, and refuses to
open once one of them was changed. Change `00001_board_up.sql` after it ran, and
opening boards fails with:

```text
Error: Migration 00001_board was changed after it was applied: put its up file back as it was, and make the change a new migration
```

`status`, in the script below, names such a migration instead of failing.

The twins are no exception. A fix to a Postgres migration that already ran somewhere
is a new migration, in both folders, with the same number.

## Analytics on either database

`SqlAnalytics` (chapter [26](./26-dead-jobs-and-analytics)) keeps every dataset's rows
as JSON text in `analytics_row`, and counts them by a field with Kysely. Kysely writes
the same query on both databases, but for one thing: how to read a field of the JSON.
SQLite says `json_extract(data, '$.field')`, Postgres `data::jsonb ->> 'field'`.

Import `SqliteStore` as a value now (it is tested with `instanceof`), and
`PostgresStore`'s type:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
import { sql, type RawBuilder } from 'kysely'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { PostgresStore } from 'newt/adapter-postgres'
import { kyselyFor } from 'newt/kysely'
```

The class's doc names both databases and the folder of each:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
/**
 * newt's analytics port on the context's own SQL database, SQLite or Postgres, for an
 * application whose numbers are small enough for it: newt brings no adapter yet
 * (ClickHouse and DuckDB will come). Every dataset is in one table, `analytics_row`,
 * each row whole as JSON, in the database of the context that reads it: it copies
 * `migrations/<sqlite|postgres>/00001_analytics_up.sql` into its own. Its queries are
 * Kysely's, the same on both, but for reading a field of the JSON.
```

The constructor takes either store:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
  constructor(private readonly store: SqliteStore | PostgresStore) {
    this.db = kyselyFor<AnalyticsDatabase>(store)
  }
```

And `fieldOf` asks which one it is:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
  /**
   * A field of the JSON, as text: each database says it its own way (DuckDB or
   * ClickHouse would read a column). The field's name is written in the query, not
   * sent apart: Postgres groups by an expression only if it is written the same. It is
   * a name, checked above, never a piece of SQL.
   */
  private fieldOf(field: string): RawBuilder<string> {
    return this.store instanceof SqliteStore
      ? sql<string>`json_extract(data, ${sql.lit(`$.${field}`)})`
      : sql<string>`(data::jsonb ->> ${sql.lit(field)})`
  }
```

`sql.lit` writes the name into the query rather than sending it as a parameter.
`countBy` selects, filters and groups by the same expression; with a parameter,
Postgres would see three different `$1`, `$2`, `$3` and refuse to group. The name is
safe to write: `countBy` checked it against `FIELD` first.

This is the one place in cooper that knows which database it runs on, and it is not a
module: it is an adapter of a port.

## MySQL

newt has a third SQL store, `MySqlStore` from `newt/adapter-mysql`, opened the same
way (`MySqlStore.open({ url: 'mysql://…?sslmode=require', migrations })`). For cooper it
would be one more line in `openStore`, for `mysql://` addresses, and a third folder of
twins: ids `VARCHAR(36)`, text `utf8mb4_0900_bin`, booleans 0 and 1, JSON `JSON`, and a
unique value among the rows not deleted as a functional index on
`(IF(deleted_at IS NULL, col, NULL))`. MySQL also commits each change of structure at
once, so a migration batch that fails halfway is not undone. cooper does not ship it.
The [stores reference](../reference/stores) has every difference.

## Guards earn their keep here

On SQLite, every save takes its turn: one transaction at a time, in the whole
database. On Postgres and MySQL, transactions run side by side, at `READ COMMITTED`.
That is the difference chapter [6](./06-rules-over-rows) warned about:

| Store | Without `guard` | With `guard` |
|---|---|---|
| Files, SQLite | Saves run one at a time. | The same. |
| Postgres, MySQL | Saves run side by side: two `after`s may count before either commits. | Saves that share a key take turns. |

On Postgres, each key a save guards is a lock in the database for its transaction
(`pg_advisory_xact_lock`, named after the database and the key). Two saves of the same
board's columns (`columns:<board id>`) take turns; saves of different boards do not
wait for each other. A deadlock or a serialization failure is a
`ConcurrencyConflict`, and the use case runs again, as it does on a stale version.

So every rule over rows you wrote under a guard holds here as it did on SQLite, with
no change: ten columns per board, the 500 cards, a board's name once per workspace,
the card numbers. Had a save forgotten its guard, SQLite would have forgiven it, and
Postgres would not. That is why the guard rule refuses, on every store and from the
first day, a save that reads rows and guards nothing: by the time a context moves to
Postgres, there is nothing left to find.

## Migrating by hand

The server migrates each context as it opens it. That is right in development. In
production you often want it apart: to see what a new version will apply, to apply it
before the servers start (so a failing migration fails in a command you are watching,
not in the start of a server), or to revert the last one.

That is the script, `cooper/scripts/migrations.ts`:

```ts
// cooper/scripts/migrations.ts
// bun run cooper:migrations <status|up|down> [--context auth|boards|backoffice]: each
// context's database migrated by hand. The server migrates on its own as it
// opens each context; this is for looking at what is pending, applying it before a
// deploy, or reverting the last one. `status` and `up` go through every context unless
// one is named; `down` reverts one context's last migration, so it needs its name.
// `status` also names the migrations applied whose up file was changed since, which
// `up` and the server's start refuse.
// Each context's database is the one it opens (`COOPER_<CONTEXT>_DATABASE`): a SQLite
// file, or a Postgres address, migrated with that database's own folder of migrations.
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { config } from '../backend/config'
import { connectStore } from '../backend/shared/open-store'

const CONTEXTS = ['auth', 'boards', 'backoffice'] as const
type ContextName = (typeof CONTEXTS)[number]
const COMMANDS = ['status', 'up', 'down'] as const

const { positionals, values } = parseArgs({ allowPositionals: true, options: { context: { type: 'string' } } })
const [command] = positionals
const named = values.context

if (!COMMANDS.includes(command as (typeof COMMANDS)[number]) || (named !== undefined && !CONTEXTS.includes(named as ContextName))) {
  console.error('Usage: bun run cooper:migrations <status|up|down> [--context auth|boards|backoffice]')
  process.exit(1)
}
if (command === 'down' && named === undefined) {
  console.error('down reverts one context\'s last migration: say which, with --context')
  process.exit(1)
}

const contexts = named === undefined ? CONTEXTS : [named as ContextName]

for (const context of contexts) {
  // `connect` opens the database as it is: `open` would migrate it first.
  const store = await connectStore(config[context].database, join(import.meta.dir, `../backend/contexts/${context}/migrations`))
  try {
    if (command === 'status') {
      const { applied, pending, changed } = await store.migrations.status()
      console.log(`${context}: ${applied.length} applied${applied.length ? ` (last ${applied.at(-1)})` : ''}, ${pending.length} pending${pending.length ? `: ${pending.join(', ')}` : ''}`)
      // One changed after it was applied stops `up` and the server's start: say which, and what to do.
      if (changed.length) console.log(`${context}: changed after they were applied: ${changed.join(', ')}; put their up files back as they were, and make the change a new migration`)
    } else if (command === 'up') {
      const applied = await store.migrations.up()
      console.log(`${context}: ${applied.length ? `applied ${applied.join(', ')}` : 'up to date'}`)
    } else {
      const reverted = await store.migrations.down()
      console.log(`${context}: ${reverted ? `reverted ${reverted}` : 'nothing to revert'}`)
    }
  } finally {
    await store.close()
  }
}
```

It opens each context's database with `connectStore`, which does not migrate, and
calls the store's `migrations`:

- **`status()`**: a `MigrationStatus`, `{ applied, pending, changed }`, the names of
  each. `changed` are the applied ones whose up file no longer matches its checksum.
  `status` does not refuse them, as `open` and `up` do: it is where you go to find
  out what is wrong, so it names them and says what to do.
- **`up()`**: applies what is pending, and returns the names it applied. Through
  `connect`, it also applies the framework's own tables after the context's (the
  outbox: `job`, `job_queue`, `schedule_tick`), as `open` does.
- **`down()`**: reverts the last one applied, and returns its name, or `null`.

`down` needs `--context`: reverting the last migration of every context at once is
never what you meant.

The script reads the same settings as the server, so it migrates the databases the
server would open. Add it to the root `package.json`, after `cooper:seed`:

```json
"cooper:migrations": "bun run cooper/scripts/migrations.ts",
```

## A test on Postgres

Every test so far runs on SQLite in memory. One more runs cooper on a real Postgres,
when you give it one: `COOPER_TEST_POSTGRES_URL`, the address of a user with the right
to create databases on that server (a role with `CREATEDB`). Without it, the file defines no test, and `bun test cooper` skips
it.

```ts
// cooper/backend/postgres.test.ts
import { afterAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { join } from 'node:path'
import { runAsActor } from 'newt/core'
import { PostgresStore } from 'newt/adapter-postgres'
import { describeAnalyticsContract } from 'newt/port-analytics/contract'
import { config, type Config } from './config'
import { PRODUCTS } from './contexts/auth/modules/product/product.schema'
import { inWorkspace } from './contexts/boards/workspace-scope'
import { openContexts, stopContexts } from './open-contexts'
import { SqlAnalytics } from './shared/analytics/sql-analytics'
import { connectStore } from './shared/open-store'

/**
 * cooper on Postgres, when there is one to test against: `COOPER_TEST_POSTGRES_URL`,
 * the address of a user with the right to create databases (`CREATE DATABASE`, a
 * role with `CREATEDB`) on that server. Without it, these tests are skipped. Each context gets a database of its own, `cooper_test_<context>`, dropped
 * and made again: never one that matters.
 */
const url = process.env.COOPER_TEST_POSTGRES_URL

const CONTEXTS = ['auth', 'boards', 'backoffice', 'analytics'] as const

/** The address of a fresh, empty database of that name, on the same server. */
async function fresh(name: (typeof CONTEXTS)[number]): Promise<string> {
  const database = `cooper_test_${name}`
  const admin = new SQL(url!)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${database}`)
  await admin.close()
  const address = new URL(url!)
  address.pathname = `/${database}`
  return address.toString()
}

/** cooper's settings, every context on a fresh Postgres database. */
async function postgresConfig(): Promise<Config> {
  return {
    ...config,
    auth: { ...config.auth, database: await fresh('auth'), port: 0 },
    boards: { ...config.boards, database: await fresh('boards'), port: 0 },
    backoffice: { ...config.backoffice, database: await fresh('backoffice'), port: 0 },
  }
}

if (url) {
  describe('cooper on Postgres', () => {
    test('opens every context migrated, and works across them as on SQLite', async () => {
      const settings = await postgresConfig()
      const contexts = await openContexts(settings, { mailer: { send: async () => {} } })
      const settled = async () => {
        for (let round = 0; round < 2; round++) for (const context of contexts.all) await context.base.jobs.idle()
      }
      try {
        const { user, tenant, access } = contexts.auth.modules
        const ana = await user.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })
        await access.admit({ userId: ana.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
        const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id, via: 'web' }, fn)
        const acme = await asAna(() => tenant.create({ name: 'Acme' }))
        await settled()

        const { board, column, card, member } = contexts.boards.modules
        const found = await asAna(() => inWorkspace(member, acme.id, async () => {
          const roadmap = await board.create({ name: 'Roadmap' })
          await expect(board.create({ name: 'ROADMAP' })).rejects.toMatchObject({ code: 'board.name_taken' })
          const todo = await column.add(roadmap.id, { name: 'To do' })
          const cards = await Promise.all(['Plan', 'Design', 'Plan again'].map(title => card.create(roadmap.id, { columnId: todo.id, title })))
          expect(cards.map(each => each.number).toSorted()).toEqual([1, 2, 3])
          await settled()
          return card.search({ text: 'PLAN' }, { size: 10 })
        }))
        expect(found.items.map(each => each.title).toSorted()).toEqual(['Plan', 'Plan again'])
        // The welcome board's card, and the three above.
        expect(await card.countByWorkspace([acme.id])).toEqual([{ workspaceId: acme.id, cards: 4 }])

        const overview = await asAna(() => contexts.backoffice.modules.metric.overview())
        expect(overview.totals).toEqual({ cards: 4, workspaces: 1, signUps: 1 })
        expect(overview.cardsPerDay.at(-1)!.count).toBe(4)
      } finally {
        await stopContexts(contexts)
      }

      // The migrations script sees each database up to date.
      for (const context of ['auth', 'boards', 'backoffice'] as const) {
        const store = await connectStore(settings[context].database, join(import.meta.dir, 'contexts', context, 'migrations'))
        try {
          expect((await store.migrations.status()).pending).toEqual([])
        } finally {
          await store.close()
        }
      }
    }, 30_000)
  })

  const stores: PostgresStore[] = []
  afterAll(async () => {
    for (const store of stores.splice(0)) await store.close()
  })
  describeAnalyticsContract('SqlAnalytics on Postgres', {
    async open() {
      for (const store of stores.splice(0)) await store.close()
      const store = await PostgresStore.open({ url: await fresh('analytics'), migrations: join(import.meta.dir, 'shared/analytics/migrations/postgres') })
      stores.push(store)
      return new SqlAnalytics(store)
    },
    rows: (analytics, dataset) => analytics.rows(dataset),
  })
}
```

- **A fresh database per context**, `cooper_test_<context>`, dropped and made again,
  so the test runs as many times as you like. Never point it at a server whose
  `cooper_test_*` databases matter.
- **The first test is the whole of cooper on Postgres**, opened by `openContexts` as
  the server opens it: each context migrated as it opens, a sign-up in auth, a
  workspace whose welcome board boards makes from auth's event, a board name refused
  in another case, three cards created at once (numbered 1, 2 and 3: the guard on the
  board's counter at work, now that saves run side by side), the search, the counts
  with Kysely, and the backoffice's overview over all of it.
- **Then the migrations script's view**: `connectStore` sees each database with
  nothing pending.
- **`describeAnalyticsContract`** runs the analytics port's contract (chapter
  [26](./26-dead-jobs-and-analytics)) against `SqlAnalytics` on Postgres: the same
  promises as on SQLite.

## Check it

The gate, as at the end of every chapter:

```sh
bun install && bun check && bun test cooper && bun run lint && bun run cooper:build
```

Without `COOPER_TEST_POSTGRES_URL`, `postgres.test.ts` has nothing to run:

```sh
bun test cooper/backend/postgres.test.ts
```

```text
 0 pass
 0 fail
Ran 0 tests across 1 file.
```

To run it for real, start a Postgres 17 in Docker, on a port of your own:

```sh
docker run -d --rm --name cooper-pg -e POSTGRES_PASSWORD=pw -p 55437:5432 postgres:17
COOPER_TEST_POSTGRES_URL=postgres://postgres:pw@localhost:55437/postgres bun test cooper/backend/postgres.test.ts
```

```text
 5 pass
 0 fail
 14 expect() calls
Ran 5 tests across 1 file.
```

One test is cooper's; the other four are the analytics contract's.

Now the script, by hand, against a database of boards' own on the same server:

```sh
docker exec cooper-pg psql -U postgres -c 'CREATE DATABASE cooper_boards'
export COOPER_BOARDS_DATABASE=postgres://postgres:pw@localhost:55437/cooper_boards
bun run cooper:migrations status --context boards
```

```text
boards: 0 applied, 6 pending: 00001_board, 00002_column, 00003_card, 00004_idempotency_key, 00005_activity, 00006_session
```

```sh
bun run cooper:migrations up --context boards
```

```text
boards: applied 00001_board, 00002_column, 00003_card, 00004_idempotency_key, 00005_activity, 00006_session
```

Now break the rule of the checksums on purpose: add a line to a migration that ran,
and ask again.

```sh
echo "-- a comment" >> cooper/backend/contexts/boards/migrations/postgres/00001_board_up.sql
bun run cooper:migrations status --context boards
```

```text
boards: 6 applied (last 00006_session), 0 pending
boards: changed after they were applied: 00001_board; put their up files back as they were, and make the change a new migration
```

`up` now fails with the checksum's error, as the server's start would. Take the line
out of the file again, and the status is clean:

```sh
bun run cooper:migrations status --context boards
```

```text
boards: 6 applied (last 00006_session), 0 pending
```

```sh
bun run cooper:migrations down --context boards
bun run cooper:migrations status --context boards
```

```text
boards: reverted 00006_session
boards: 5 applied (last 00005_activity), 1 pending: 00006_session
```

Without `--context`, `down` refuses:

```text
down reverts one context's last migration: say which, with --context
```

Then the server itself, every context on Postgres. Make the two other databases, and
start it with the three addresses:

```sh
docker exec cooper-pg psql -U postgres -c 'CREATE DATABASE cooper_auth'
docker exec cooper-pg psql -U postgres -c 'CREATE DATABASE cooper_backoffice'
export COOPER_AUTH_DATABASE=postgres://postgres:pw@localhost:55437/cooper_auth
export COOPER_BACKOFFICE_DATABASE=postgres://postgres:pw@localhost:55437/cooper_backoffice
bun cooper/backend/index.ts
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
backoffice listening on http://localhost:3003/
```

boards applied the `00006_session` you reverted as it opened. Sign someone up, and
ask for the status from another terminal (with the same three variables):

```sh
curl -s -X POST localhost:3001/api/session/sign-up -H 'content-type: application/json' \
  -d '{"email":"ana@cooper.test","name":"Ana","password":"a long password"}'
bun run cooper:migrations status
```

```text
auth: 9 applied (last 00009_token), 0 pending
boards: 6 applied (last 00006_session), 0 pending
backoffice: 2 applied (last 00002_analytics), 0 pending
```

Stop the server, and remove the container when you are done:

```sh
docker rm -f cooper-pg
```

## What to remember

- The store is a port: a context picks it in its `open`, and the modules never learn
  which one it is. cooper picks it from the database's address, in one function
  (`openStore`); `CooperBase` carries the union of the stores it may be.
- Migrations are SQL in each database's dialect: one folder per dialect, the same
  numbers and names. On Postgres, text is `COLLATE "C"` (so it compares as everywhere
  else), booleans `BOOLEAN`, JSON `JSONB`.
- An applied migration never changes, on any store: a checksum refuses it, and
  `status` names it. A fix is a new migration, in every dialect's folder.
- `open` migrates; `connect` does not. Migrating by hand (`status`, `up`, `down`) goes
  through `connect`, before a deploy or to revert the last one.
- Postgres and MySQL run saves side by side: the guards you named on SQLite are what
  keep the rules over rows there. The guard rule made sure none is missing.

Next: [Observability](./28-observability).
