# newt

A backend framework for [Bun](https://bun.sh). An application is made of **bounded
contexts**, each one made of **modules**; a module owns one entity, changes it only
through its **use cases**, and tells the rest what happened through **domain
events**, which a transactional outbox delivers. Where the data lives is a **store**
the context picks: SQLite, plain files, Postgres and MySQL come with it, and any
other is an adapter you write against one port.

It runs on Bun only: it uses `Bun.serve`, `bun:sqlite` and Bun's APIs as they are.

```sh
bun add newt-kit zod
bun add -d newt-kit-eslint eslint typescript@npm:@typescript/typescript6@6.0.2
```

newt's lint runs on TypeScript 6 for now (typescript-eslint does not support 7 yet): in a
project made with `bun init`, `bun remove typescript` first.

A coding agent reads [`AGENTS.md`](./AGENTS.md) first: the framework's rules on one
page, what each error it throws means and what to do about it, the lint's rules and a
definition of done. It ships with the package, so an application's agent finds it in
`node_modules/newt-kit/AGENTS.md`, as current as the newt it runs on.

## Command line

```sh
bunx newt-kit init                                  # AGENTS.md, CLAUDE.md and newt's lint, for an application
bunx newt-kit add module src/contexts/shop order    # a module's skeleton: compiles, passes the lint, has a test
```

Neither overwrites a file: what is there already is said and left as it was. The
module's repository says `scope: 'none'` with a note to decide it: a tenant's scope,
or none and why.

## Entries

| Import | What it has |
|---|---|
| `newt-kit/core` | Modules, entities, use cases, events, errors and their messages, the actor and other scopes, what to find (`Criteria`) and the filters a client may send (`defineFilter`), pagination, value objects, observability. |
| `newt-kit/contract` | What a backend and its clients share, safe in a browser: value objects and their errors, `defineFilter`, `Page`, `PageRequest` and `ErrorBody`, the body of a failed request. |
| `newt-kit/repository` | Where a module reads and writes its entities: `TableRepository`, `Repository`. |
| `newt-kit/port-store` | The port a store implements: `Store`, `Table`, `Migrations`, `TransactionScope`. |
| `newt-kit/port-store/contract` | `describeStoreContract`: the suite that checks a store keeps every promise. |
| `newt-kit/port-outbox` | The port of the jobs of `handler` subscriptions: `Outbox`, `Job`. |
| `newt-kit/port-analytics` | The port of an analytical database: `Analytics`. |
| `newt-kit/port-analytics/contract` | `describeAnalyticsContract`, and `MemoryAnalytics`: one in memory, for tests. |
| `newt-kit/runtime` | A context at runtime: `Base`, `BoundedContext`, the worker of its jobs, and its schedules. |
| `newt-kit/sql` | What every SQL store shares: its table, and the whole store on a database server. |
| `newt-kit/adapter-sqlite` | `SqliteStore`: SQLite on `bun:sqlite`, with SQL migrations. |
| `newt-kit/adapter-postgres` | `PostgresStore`: Postgres on `Bun.SQL`, transactions side by side. |
| `newt-kit/adapter-mysql` | `MySqlStore`: MySQL on `Bun.SQL`, transactions side by side. |
| `newt-kit/adapter-files` | `FileStore`: one JSON file per record, transactions through a journal, migrations in TypeScript. |
| `newt-kit/application` | `runContexts`: an application's contexts in one process, served, their workers started, stopped in order on a signal. |
| `newt-kit/otel` | `OtlpTracer`: the tracer that sends spans to an OpenTelemetry collector (OTLP/HTTP, JSON), with no SDK. Optional. |
| `newt-kit/testing` | For a test of an HTTP entry: `freePort`, and `browser`, a `fetch` that keeps its cookies and never follows a redirect. |
| `newt-kit/http` | `HttpRouter`, groups with middleware and `serve`: routes per module, sessions, errors as responses. Optional. |
| `newt-kit/kysely` | `kyselyFor`: Kysely on any SQL store, for queries of one's own. Optional (needs `kysely`). |

Nothing else in the package is public.

## A context in a few lines

```ts
import { Base, BoundedContext } from 'newt-kit/runtime'
import { FileStore } from 'newt-kit/adapter-files'
import { HttpRouter, serve } from 'newt-kit/http'

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

The documentation is a site in [`web/`](../../web) (`bun run docs:dev`): **the newt
manual**, which explains newt through cooper, its example application.

- [**The essentials**](../../web/manual/00-how-to-read.md): contexts, modules, entities,
  use cases, repositories, routes, events, workers, testing and production.
- [**Going deeper**](../../web/manual/20-concurrency.md): concurrency, tenants, time,
  stores, security, rate limits, auth and OAuth, MCP, observability, coding agents.
- [**The appendices**](../../web/manual/a-rules.md): the rules, the lint, the command
  line and every export.

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
runtime/           a context running: Base, the event bus, the job worker, the schedules; knows core, port-store, port-outbox
sql/               what SQL stores share; knows core, port-store, port-outbox
adapter-sqlite/    an adapter; knows sql and what it builds on
adapter-postgres/  an adapter; knows sql
adapter-mysql/     an adapter; knows sql
adapter-files/     an adapter; knows core, port-store, port-outbox
kysely/            Kysely on the SQL stores; knows them
http/              the HTTP entry; knows core, and port-store's Table (idempotency keys)
application/       an application's contexts, run; knows core, runtime and http
otel/              a tracer for OpenTelemetry's collectors; knows core
testing/           helpers for a test over HTTP; knows nothing else
cli/               the command line (`bin`: newt); writes files, imports none of the pieces
```

What a piece needs from another that applications must not reach goes through that
piece's `internal.ts`, which is not a subpath.

The package's `exports` keep an application to its entries.
