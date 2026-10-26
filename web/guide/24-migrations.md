# Migrations

The shape of the data changes with the application: a new table for a new module, a
column for a new field, an index for a new search. **Migrations** are those changes,
applied in order and remembered by the store. This chapter shows how cooper keeps
them, and the rules that keep them safe.

## One folder per context

Each context has its own store, so each has its own migrations, in a `migrations/`
folder beside its context file. The store applies the pending ones when the context
opens it:

```ts
// cooper/backend/contexts/boards/boards.context.ts
static async open(config: Boards_Config, deps: Boards_ModuleDeps, tracer?: Tracer): Promise<Boards_Context> {
  const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
  const base = new BoardsBase({ name: 'boards', store, tracer })
  return new Boards_Context(base, initializeModules(base, config, deps), config, deps.auth)
}
```

`SqliteStore.open` migrates before it returns. A context never starts on old data, and
a test that opens `:memory:` gets the same tables as production.

cooper's migrations today:

```
cooper/backend/contexts/auth/migrations/
  00001_user_up.sql           00001_user_down.sql
  00002_session_up.sql        00002_session_down.sql
  00003_oauth-client_up.sql   00003_oauth-client_down.sql
  00004_oauth-grant_up.sql    00004_oauth-grant_down.sql
  00005_token_up.sql          00005_token_down.sql
  00006_tenant_up.sql         00006_tenant_down.sql
  00007_access_up.sql         00007_access_down.sql
  00008_invitation_up.sql     00008_invitation_down.sql
  00009_access-once_up.sql    00009_access-once_down.sql
cooper/backend/contexts/boards/migrations/
  00001_boards_up.sql         00001_boards_down.sql
  00002_session_up.sql        00002_session_down.sql
  00003_card_counter_up.sql   00003_card_counter_down.sql
  00004_activity_up.sql       00004_activity_down.sql
cooper/backend/contexts/backoffice/migrations/
  00001_session_up.sql        00001_session_down.sql
  00002_analytics_up.sql      00002_analytics_down.sql
```

auth grew one module at a time, and has a migration for each, plus one that came
later to fix a rule (`00009`). boards made its three first tables at once, then added
a table for each change after them. Either is fine: a migration is a change, not a
module.

## Names

A migration is a pair of files: `000NN_<name>_up.sql`, what changes, and
`000NN_<name>_down.sql`, how to undo it. The number is five digits, and orders them.
The name says what it is about. A file whose name does not have this shape is ignored,
so a `README` in the folder does no harm.

The store keeps what it applied in a table, `migrations`: the number, the name, when.
newt's own tables (the outbox's `job` and `job_queue`) have migrations of their own,
recorded apart in `framework_migrations` and applied after yours, so their numbers
never meet.

## Writing one

Here is boards' first migration, trimmed:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- boards' tables: each workspace's boards, their columns and their cards. Every row
-- says its workspace (an auth tenant), by id and without a foreign key: the workspace
-- is another context's, and the repositories see only the rows of the current one.

-- An archived board keeps its row (`deleted_at` set): its name is free again.
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

-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  -- …
);

-- …
```

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_down.sql
DROP TABLE card;
DROP TABLE "column";
DROP TABLE board;
```

The rules it follows:

- **Each field of the entity is a column**, its name in snake case (`workspaceId` →
  `workspace_id`). The table of an entity has `id TEXT PRIMARY KEY` and
  `version INTEGER NOT NULL`.
- **A unique value is a unique index.** With soft delete (`deletedAt`), make it
  partial, `WHERE deleted_at IS NULL`, so a deleted row frees its value. That is how
  an archived board frees its name.
- **No foreign key to another module's table, nor another context's.** `card` points
  at its column, its board and its assignee by id only. The column is another module's
  ([chapter 18](./18-references)), and the assignee lives in another database. What
  keeps those references right is the code, through events.
- **A name that is a word of SQL is quoted**: `"column"` in boards, `"user"` in auth.
- **`down` undoes exactly what `up` did**, in reverse order.

Comments are welcome. A migration is read long after it is written, and the comment is
where the reason for an index or a missing foreign key lives.

## A migration shared between contexts

boards and the backoffice both sign people in through auth with the same module,
`shared/web-session`, and that module needs a `session` table in each of their
databases. Each store reads one folder, numbered in one sequence, so a context cannot
point at a second folder. The shared module keeps the migration, and each context
**copies** it into its own folder, numbered after the ones it has:

```sql
-- cooper/backend/shared/web-session/migrations/00001_session_up.sql
-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user ON session (user_id);
```

In boards it is `00002_session_up.sql`. In the backoffice it is
`00001_session_up.sql`, followed by `00002_analytics_up.sql`, the copy of
`shared/analytics`'s. The shared folders are not wasted: the shared modules' own tests
open a store on them.

When the shared module changes its table, it adds a migration to its folder, and every
context that uses it copies that one too, with its next number. A copy is a migration
like any other: once applied, it is never edited.

## How SQLite runs them

newt's SQLite store is careful with migrations, and it helps to know how:

- **All pending migrations run in one transaction**, all or none. If the third of
  three fails, the first two are undone too, and the context does not start.
- **A file runs one statement at a time**, split as SQLite reads it. A trigger, with
  semicolons in its body, is one statement. A statement that fails fails the file:
  run whole, SQLite would report only the last one's error.
- **Foreign keys are off during a migration.** SQLite documents how to change a
  table's shape: create the new one, copy the rows, drop the old one, rename. With
  foreign keys on, dropping the old table would delete or refuse the rows that point
  at it. Since SQLite ignores turning them off inside a transaction, newt turns them
  off before it begins, and runs `PRAGMA foreign_key_check` before it commits: a
  migration that leaves a row pointing at nothing fails.
- **Two files with the same number and different names are refused**:
  `Migrations 00003_a_up.sql and 00003_b_up.sql share the version 00003: renumber one`.
  It happens when two branches each add a migration. Renumber yours.
- **A file without its pair is refused** (`Migration 3_tags is missing its down file`).
- **A database ahead of the code does not start.** If the last migration it applied
  is not in the folder (you went back to an older branch), opening fails rather than
  run old code on new tables.
- **A folder that cannot be read is an error**, never "no migrations". A wrong path
  does not leave you with an empty database.
- **Two processes opening the database at once take turns.** The second waits for
  the first, then finds its migrations applied.

## Changes that came later

A database in use already has rows. A migration written after the first ones must
take them as they are. cooper has three such migrations, each a different kind of
change.

**A new table, filled from the rows there are.** Card numbers used to be the highest
number of the board plus one. Delete the last card, and its number came back for the
next one. So boards keeps, for each board, the last number it gave, in a table of its
own ([chapter 9](./09-shared-counters)). A database that already has cards cannot
start that table empty: the next card would be #1 again. The migration fills it from
the cards there are, in the same file:

```sql
-- cooper/backend/contexts/boards/migrations/00003_card_counter_up.sql
-- The last number each board gave a card, so a deleted card's number is never given
-- again: cards are deleted for good, and the highest one left is not the last one
-- given. Its id is the board's. A board that has cards starts from its highest number.
CREATE TABLE card_counter (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);

INSERT INTO card_counter (id, workspace_id, last_number, version)
SELECT board_id, workspace_id, max(number), 1 FROM card GROUP BY board_id, workspace_id;
```

The comment says what the table is and why it starts from the highest number. Both
statements run in the transaction of the migration: if the `INSERT` failed, the table
would not stay half made.

**A table for a new module.** The activity of each card is a module of its own, with
a table that only grows:

```sql
-- cooper/backend/contexts/boards/migrations/00004_activity_up.sql
-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  -- …
);
-- A card's activity, the newest first (ids are v7: in the order they were told).
CREATE INDEX activity_card ON activity (workspace_id, card_id, id);
```

Nothing to fill: the activity starts the day the module does. No foreign key to
`card` either: a card deleted keeps its history, and the `card_id` keeps pointing at a
row that is gone, on purpose.

**A rule the database keeps too.** auth gives each person one access per product and
tenant. Its code checked it, but two saves at once could both pass the check. The fix
was a guard in the save and, as the last word, a unique index:

```sql
-- cooper/backend/contexts/auth/migrations/00009_access-once_up.sql
-- One access per person, product and tenant: two saves giving the same one at once
-- cannot both succeed. A null tenant (the whole product) counts as a value, so the
-- staff's access is kept once too.
CREATE UNIQUE INDEX access_once ON access (user_id, product_id, ifnull(tenant_id, ''));
```

In a unique index, two `NULL`s are never equal, so `(ana, backoffice, NULL)` could be
there twice. `ifnull(tenant_id, '')` makes the staff's access, which has no tenant,
count once like any other. An index like this one fails to build if the table already
breaks it: if a database might have duplicates, the migration removes them first.

```sql
-- cooper/backend/contexts/auth/migrations/00009_access-once_down.sql
DROP INDEX access_once;
```

## Never rewrite one that was applied

The store remembers a migration by its number and name, not by its content. Edit a
file that was already applied and nothing happens on the databases that have it:
they never run it again. A fresh database (a colleague's, a test's) runs the new
version. Now two databases that both say "00002 applied" have different tables, and
nothing warns you.

So a change is a new migration. To add a column to cards, write
`00005_card-priority_up.sql` with an `ALTER TABLE`, and a `down` that removes it.

::: warning
`bun run cooper` runs the backend with `--watch`. It restarts as you save, and every
restart opens the stores, which apply whatever migration is pending. A migration you
are still writing gets applied the moment the backend restarts. From then on it is
applied: fix it with a new one, or undo it with `bun run cooper:migrations down`
(below) before you edit it.
:::

**Data survives every migration.** A new column on a table with rows needs a default
(`ALTER TABLE card ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`), a table that
changes shape copies its rows into the new one, and a new table that depends on the
rows there are is filled from them, as `card_counter` is.

## Looking, and going back

`open` migrates on its own. To look first, or to undo the last one, a script opens the
store with `connect`, which does not migrate, and uses `store.migrations`:

```ts
// packages/newt/port-store/migrations.ts
export interface Migrations {
  /** Applies every pending one, all of them or none; the ones it applied. */
  up(): Promise<string[]>
  /** Reverts the last one applied; the one it reverted, if any. */
  down(): Promise<string | null>
  status(): Promise<{ applied: string[], pending: string[] }>
}
```

`status()` lists them by name (`00001_boards`). `down()` runs the last applied one's
`down` file, in a transaction like `up`. `up()` applies yours, then newt's, as `open`
does.

cooper has that script: `bun run cooper:migrations`, with a command and, optionally,
the context.

```ts
// cooper/scripts/migrations.ts
for (const context of contexts) {
  // `connect` opens the database as it is: `open` would migrate it first.
  const store = await SqliteStore.connect({
    path: config[context].dbPath,
    migrations: join(import.meta.dir, `../backend/contexts/${context}/migrations`),
  })
  try {
    if (command === 'status') {
      const { applied, pending } = await store.migrations.status()
      console.log(`${context}: ${applied.length} applied${applied.length ? ` (last ${applied.at(-1)})` : ''}, ${pending.length} pending${pending.length ? `: ${pending.join(', ')}` : ''}`)
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

```bash
bun run cooper:migrations status                     # every context: applied and pending
bun run cooper:migrations up --context boards        # apply boards' pending ones
bun run cooper:migrations down --context boards      # revert boards' last one
```

`status` and `up` go through every context unless you name one. `down` needs a
context: undoing the last migration of all three at once is never what you mean. It
reads each context's database path from `config.ts`, so the same `COOPER_*_DB_PATH`
variables point it at another database.

Use it to see what a deploy will apply before it does, to apply it ahead of the
deploy, or to undo the migration you are writing before you edit it again. Stop the
backend first when you run `down`: with `--watch` it would apply the migration again
on its next restart.

## Other stores

Postgres and MySQL use the same pairs of files and the same rules, in their own
dialect, in a folder of their own. [Chapter 26](./26-production) lists what would
change in cooper's.

## In short

- Each context has its migrations in its own folder; opening the store applies the
  pending ones.
- A migration is `000NN_<name>_up.sql` and `000NN_<name>_down.sql`.
- Columns in snake case, `id TEXT PRIMARY KEY`, `version INTEGER NOT NULL`, a unique
  index for a unique value (partial with soft delete), no foreign key across modules
  or contexts.
- A migration a shared module needs is copied into each context that uses it, with
  that context's next number.
- On SQLite: all pending ones in one transaction, statement by statement, foreign keys
  off and checked at the end, duplicate numbers refused.
- A migration written later takes the rows there are: a default for a new column, a
  new table filled from them, duplicates removed before a unique index.
- An applied migration is never edited: a change is a new migration.
- `connect` opens a store without migrating; `bun run cooper:migrations
  status|up|down` looks, applies and reverts by hand.
