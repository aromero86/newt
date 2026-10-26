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
| `newt/contract` | What a backend and its clients share, safe in a browser: value objects and their errors, `defineFilter`, `Page`, `PageRequest` and `ErrorBody`, the body of a failed request. |
| `newt/repository` | Where a module reads and writes its entities: `TableRepository`, `Repository`. |
| `newt/port-store` | The port a store implements: `Store`, `Table`, `Migrations`, `TransactionScope`. |
| `newt/port-store/contract` | `describeStoreContract`: the suite that checks a store keeps every promise. |
| `newt/port-outbox` | The port of the jobs of `handler` subscriptions: `Outbox`, `Job`. |
| `newt/port-analytics` | The port of an analytical database: `Analytics`. |
| `newt/port-analytics/contract` | `describeAnalyticsContract`, and `MemoryAnalytics`: one in memory, for tests. |
| `newt/runtime` | A context at runtime: `Base`, `BoundedContext`, and the worker of its jobs. |
| `newt/sql` | What every SQL store shares: its table, and the whole store on a database server. |
| `newt/adapter-sqlite` | `SqliteStore`: SQLite on `bun:sqlite`, with SQL migrations. |
| `newt/adapter-postgres` | `PostgresStore`: Postgres on `Bun.SQL`, transactions side by side. |
| `newt/adapter-mysql` | `MySqlStore`: MySQL on `Bun.SQL`, transactions side by side. |
| `newt/adapter-files` | `FileStore`: one JSON file per record, transactions through a journal, migrations in TypeScript. |
| `newt/application` | `runContexts`: an application's contexts in one process, served, their workers started, stopped in order on a signal. |
| `newt/otel` | `OtlpTracer`: the tracer that sends spans to an OpenTelemetry collector (OTLP/HTTP, JSON), with no SDK. Optional. |
| `newt/testing` | For a test of an HTTP entry: `freePort`, and `browser`, a `fetch` that keeps its cookies and never follows a redirect. |
| `newt/http` | `HttpRouter`, groups with middleware and `serve`: routes per module, sessions, errors as responses. Optional. |
| `newt/kysely` | `kyselyFor`: Kysely on any SQL store, for queries of one's own. Optional (needs `kysely`). |

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

One whole application shows it, with its tests: [`cooper`](../../cooper), a small
Trello-like SaaS, its staff's backoffice and the OAuth server they sign in with,
three contexts on SQLite. The guide builds it step by step.

## Documentation

The documentation is a site in [`web/`](../../web) (`bun run docs:dev`), in English
and Spanish:

- [**The guide**](../../web/guide/00-introduction.md): building a backend step by step,
  cooper's: contexts, modules, entities, use cases, transactions, events, workers,
  eventual consistency, several contexts, an OAuth server and an MCP server.
- [**The reference**](../../web/reference/rules.md): the framework's rules, its
  [stores](../../web/reference/stores.md) and its [lint](../../web/reference/lint.md).

## Pieces

Each piece is a folder and a subpath; a piece reaches another only through its
`index.ts` (or its `internal.ts`, below), and depends only on the ones above it:

```
core/              what a module is made of, and the criteria it is found by; knows nothing else
contract/          core's files a browser may load, re-exported: nothing in it keeps a scope
port-outbox/       the port of the jobs; knows nothing else
port-analytics/    the port of analytics; knows nothing else (its contract/ knows it)
port-store/        the port of a store; knows core, port-outbox (its contract/ knows repository and runtime)
repository/        where a module reads and writes its entities; knows core, port-store
runtime/           a context running: Base, the event bus, the job worker; knows core, port-store, port-outbox
sql/               what SQL stores share; knows core, port-store, port-outbox
adapter-sqlite/    an adapter; knows sql and what it builds on
adapter-postgres/  an adapter; knows sql
adapter-mysql/     an adapter; knows sql
adapter-files/     an adapter; knows core, port-store, port-outbox
kysely/            Kysely on the SQL stores; knows them
http/              the HTTP entry; knows core
application/       an application's contexts, run; knows core, runtime and http
otel/              a tracer for OpenTelemetry's collectors; knows core
testing/           helpers for a test over HTTP; knows nothing else
```

What a piece needs from another that applications must not reach goes through that
piece's `internal.ts`, which is not a subpath.

The package's `exports` keep an application to its entries.
