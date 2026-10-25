# newt

A backend framework for [Bun](https://bun.sh). An application is made of **bounded
contexts**, each one made of **modules**; a module owns one entity, changes it only
through its **use cases**, and tells the rest what happened through **domain
events**, which a transactional outbox delivers. Where the data lives is a **store**
the context picks: SQLite, plain files, Postgres and MySQL come with it, and any
other is an adapter you write against one port.

It runs on Bun only: it uses `Bun.serve`, `bun:sqlite` and Bun's APIs as they are.

```sh
bun add newt zod
```

## Entries

| Import | What it has |
|---|---|
| `newt/core` | Modules, entities, use cases, events, errors and their messages, the actor and other scopes, what to find (`Criteria`) and the filters a client may send (`defineFilter`), pagination, value objects, observability. |
| `newt/store` | The storage port (`Store`, `Table`, `Migrations`, `TransactionScope`) and the repositories built on it (`Repository`, `TableRepository`). |
| `newt/outbox` | The port of the jobs of `handler` subscriptions (`Outbox`, `Job`). |
| `newt/analytics` | The port of an analytical database (`Analytics`). |
| `newt/runtime` | A context at runtime: `Base`, `BoundedContext`, and the worker of its jobs. |
| `newt/sql` | What every SQL store shares: its table, and the whole store on a database server. |
| `newt/adapter-sqlite` | `SqliteStore`: SQLite on `bun:sqlite`, with SQL migrations. |
| `newt/adapter-postgres` | `PostgresStore`: Postgres on `Bun.SQL`, transactions side by side. |
| `newt/adapter-mysql` | `MySqlStore`: MySQL on `Bun.SQL`, transactions side by side. |
| `newt/adapter-files` | `FileStore`: one JSON file per record, transactions through a journal, migrations in TypeScript. |
| `newt/http` | `HttpRouter`, groups with middleware and `serve`: routes per module, sessions, errors as responses. Optional. |
| `newt/kysely` | `kyselyFor`: Kysely on any SQL store, for queries of one's own. Optional (needs `kysely`). |
| `newt/testing` | `describeStoreContract`, `describeAnalyticsContract`, `MemoryAnalytics`: what checks an adapter. |

Nothing else in the package is public.

## A context in a few lines

```ts
import { Base, BoundedContext } from 'newt/runtime'
import { FileStore } from 'newt/adapter-files'
import { HttpRouter, serve } from 'newt/http'

class AppBase extends Base<FileStore> {
  readonly http = new HttpRouter()
}

const base = new AppBase({ name: 'notes', store: await FileStore.open({ folder: 'data/notes' }) })
const notes = Note_Module.initialize(base)   // a module: see the guide
base.jobs.start()
serve({ port: 3000, router: base.http })
```

Two whole applications show it, each with its tests:

- [`examples/notes`](../../examples/notes): small enough to read in one go: an entity,
  its repository, its use cases, an event a worker reacts to, its routes.
- [`examples/despensa`](../../examples/despensa): a shop whose orders are confirmed in the
  background, with stock kept as movements, rules over several rows and emails
  from workers, on files or SQLite. It is the one the manual builds.

## Documentation

- [**The guide**](../../docs/guide.md): how an application is built: contexts, modules,
  entities, use cases, repositories, events, errors, HTTP.
- [**Stores**](../../docs/stores.md): what a store promises, the four that come with the
  framework, and how to write another.
- [**Manual (en castellano)**](../../docs/manual.es.md): building a backend step by step, as
  a book: transactions, events, workers and eventual consistency, with diagrams.

## Pieces

Each piece is a folder and a subpath; a piece reaches another only through its
`index.ts` (or its `internal.ts`, below), and depends only on the ones above it:

```
core/              what a module is made of; knows nothing else
outbox/            the port of the jobs; knows nothing else
analytics/         the port of analytics; knows nothing else
store/             the storage port and the repositories on it; knows core, outbox
runtime/           a context running: Base, the event bus, the job worker; knows core, store, outbox
testing/           the contract suites; knows core, store, runtime, analytics
sql/               what SQL stores share; knows core, store, outbox
adapter-sqlite/    an adapter; knows sql and what it builds on
adapter-postgres/  an adapter; knows sql
adapter-mysql/     an adapter; knows sql
adapter-files/     an adapter; knows core, store, outbox
kysely/            Kysely on the SQL stores; knows them
http/              the HTTP entry; knows core
```

What a piece needs from another that applications must not reach goes through that
piece's `internal.ts`, which is not a subpath.

The package's `exports` keep an application to its entries.
