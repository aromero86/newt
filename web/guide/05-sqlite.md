# From files to SQLite

`boards` keeps each board as a JSON file. That was enough to learn modules, use cases
and scopes, but a folder of files is not a database: every list reads the whole
folder, and the rules of the next chapters (a board name unique in its workspace, ten
columns at most) want a database that can say them too.

In this chapter `boards` moves to SQLite. Look at what changes: the context opens a
different store, and the tables are now written down as SQL migrations. Look also at
what does not change: no module, no repository, no use case, no route. The tests run
exactly as they did.

## The store is a port

Every repository you wrote talks to `base.store.table<Row>(name)`, newt's table port,
never to a database. A `FileStore` and a `SqliteStore` both answer it: the same
`find`, `count`, `page` and saves, the same criteria (`{ name: { ieq: … } }`,
`{ id: { ne: … } }`), the same transactions, the same versions. Chapter 27 adds
Postgres and MySQL behind the same port.

So the choice of store is made in one place, the context's `open`, and the type of
store in one other, `CooperBase`. The modules never learn which one they run on.

## Migrations

A database has a shape, and the shape changes with the application: a table for a new
module, a column for a new field, an index for a new rule. **Migrations** are those
changes, applied in order, and remembered by the store.

For SQLite, a migration is a pair of SQL files in a folder:
`000NN_<name>_up.sql`, the change, and `000NN_<name>_down.sql`, how to undo it. The
five digits order them. Each context has its own folder, beside its context file;
cooper keeps them under `migrations/sqlite`, since chapter 27 adds a folder per
database.

`boards`' first migration makes the `board` table:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00001_board_up.sql
-- Each workspace's boards. Like every row of boards', it says its workspace (an auth
-- tenant), by id and without a foreign key: the workspace is another context's, and
-- the repositories see only the rows of the current one.

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
```

The table is the row the repository already writes: `BoardRow`, the board's DTO plus
`version` and `deletedAt`. Each field is a column named in snake case
(`workspaceId` is `workspace_id`). An entity's table always has `id TEXT PRIMARY KEY`
and `version INTEGER NOT NULL`, which every save checks and moves on. Dates are ISO
text.

`workspace_id` has no foreign key: the workspace is `auth`'s, in another database.
The repository's scope (chapter 4) is what keeps one workspace's rows apart.

The last line is a unique index on the name, whatever its case, among the boards not
archived. Nothing uses that rule yet; the next chapter does. It is here from the
start because an applied migration must never change, as you will see below.

The down file undoes it:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00001_board_down.sql
DROP TABLE board;
```

## Opening SQLite

`SqliteStore.open` from `newt/adapter-sqlite` takes the database's `path` and the
`migrations` folder. Before it returns it applies the migrations it has not run yet,
in order, all or none, and then newt's own (the tables of its jobs, which later
chapters use). A context never starts on an old shape, and a test gets the same tables
as production.

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'

/**
 * The SaaS: each workspace's boards, their columns and cards. Its people belong to
 * workspaces that `auth` keeps: `boards` asks it through ports it is handed when it opens.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config) {
    super('boards', base, config)
  }

  static async open(config: Boards_Config, deps: Boards_ModuleDeps): Promise<Boards_Context> {
    // Brought up to date as it opens: the migrations it has not run yet, in order.
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new BoardsBase({ name: 'boards', store })
    const modules = initializeModules(base, config, deps)
    return new Boards_Context(base, modules, config)
  }
}
```

What SQLite gives you, in newt's words:

- **Transactions run one at a time**, in the order they ask, on a connection that
  writes. Reads outside them go to a second connection, read only, which sees only
  what is committed.
- **`:memory:`** is a database that lives as long as the store: a temporary file,
  removed when it closes. Tests use it, with exactly the semantics of a file on disk.

`CooperBase` says which store its base holds, so `base.store` is typed as a
`SqliteStore` everywhere:

```ts
// cooper/backend/shared/cooper-base.ts
import type { SqliteStore } from 'newt/adapter-sqlite'
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import './actor'

/**
 * What every module of cooper receives: newt's base, on SQLite, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
```

## The setting

The folder setting becomes `database`, read from `COOPER_BOARDS_DATABASE`, a SQLite
file under `data/` by default. `fromRoot` leaves `:memory:` as it is, so a test can
pass it through the same setting:

```ts
// cooper/backend/config.ts
import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

const env = process.env

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens and where its database lives.
 */
export const config = {
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
  },
}

export type Config = typeof config
```

`Boards_Config` is `Config['boards']`, so it follows on its own.

## Tests in memory

`openTestBoards` no longer makes a folder, nor removes one: each test opens its own
database in memory, and it is gone when the context stops.

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { Boards_Context } from '../boards.context'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, and who
 * sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    async close(): Promise<void> {
      await boards.stop()
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

`board.test.ts` does not change at all. In `boards.context.test.ts`, one test looked
at the board's file. There is no file now, so that line goes, and the test's name
says less:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board, and gives it back', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id

    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
// …
```

## An applied migration never changes

The store remembers each migration it applied, with a **checksum** of its up file. As
it opens, it checks them again, and refuses to open if one applied was changed since.
A changed migration would leave two databases with different shapes under the same
number: yours, migrated with the old file, and a new one, migrated with the new file.

So a change to the shape is always a **new** migration (`00002_…`). Before a migration
is shared with anyone, you may also undo it (`down`), change it and apply it again;
chapter 27 shows the commands.

A test keeps that promise in view. Add the imports it needs at the top of
`boards.context.test.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { serve } from 'newt/http'
// …
```

And add this `describe` at the end of the file. It copies the migrations to a
temporary folder, opens a database with them, appends an index to the applied
migration, and opens it again:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
// …
describe('boards\' migrations', () => {
  test('are checked as the store opens: one changed after it was applied is refused', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'cooper-migrations-'))
    try {
      const migrations = join(folder, 'sqlite')
      await cp(join(import.meta.dir, 'migrations', 'sqlite'), migrations, { recursive: true })
      const path = join(folder, 'boards.db')
      await (await SqliteStore.open({ path, migrations })).close()

      const board = join(migrations, '00001_board_up.sql')
      await Bun.write(board, `${await Bun.file(board).text()}\nCREATE INDEX board_description ON board (description);\n`)

      await expect(SqliteStore.open({ path, migrations })).rejects.toThrow('Migration 00001_board was changed after it was applied')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
```

## What did not change

Nothing under `modules/` was touched. Ask git, comparing this chapter's checkpoint
with the last one:

```sh
git diff --stat tutorial/04 tutorial/05 -- cooper/backend/contexts/boards/modules
```

It prints nothing. `Board_Repository` still says `base.store.table<BoardRow>('board')`,
and the scope, the soft delete, the pages and the versions behave as they did on
files. That is what a port buys: the store is a decision of the context, made in one
line, and the modules are written once.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

The tests that passed on files pass on SQLite, unchanged. Now see the checksum refuse
by hand. Start the server, create a board, and stop it:

```sh
bun cooper/backend/index.ts
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"Roadmap"}' localhost:3002/api/workspaces/acme/boards
# {"id":"01a1…","workspaceId":"acme","name":"Roadmap",…}
```

The database is `data/cooper-boards.db`. Append a line to the migration that was
applied:

```sh
echo 'CREATE INDEX board_description ON board (description);' >> cooper/backend/contexts/boards/migrations/sqlite/00001_board_up.sql
bun cooper/backend/index.ts
# error: Migration 00001_board was changed after it was applied: put its up file back as it was, and make the change a new migration
```

The store refuses to open, and the server never starts. Remove the line you added,
start it again, and the board is there:

```sh
bun cooper/backend/index.ts
curl -H 'x-user: ana' localhost:3002/api/workspaces/acme/boards
# {"items":[{"id":"01a1…","workspaceId":"acme","name":"Roadmap",…}],"hasMore":false,"total":1}
```

## What to remember

- The store is a port. The context picks it in its `open`, `CooperBase` names its
  type, and no module, repository or use case changes when it does.
- SQLite's shape is SQL migrations, `000NN_<name>_up.sql` and `_down.sql`, one folder
  per context. Opening the store applies the pending ones, so a context never starts on
  an old shape.
- An applied migration never changes: the store keeps its checksum and refuses to
  open. A change is a new migration.
- Tests open `:memory:`: a database of their own, with the same semantics, gone when
  the context stops.

Next: [Rules over rows](./06-rules-over-rows).
