# What cooper asked of newt

Building cooper (three contexts, an OAuth server, an MCP server, a backoffice) showed
where newt makes an application write something every application would write again.
Each item says where it hurt in cooper and what newt could offer. They were decided
on 2026-10-26; the status of each is in the table at the end.

## Queries and criteria

- **Text search.** Criteria and `defineFilter` have `eq`, `ne`, `in`, ranges and
  `ieq`, but nothing that matches part of a value. Card search needed a Kysely query,
  and the backoffice can only find a user or a workspace by its whole name or email.
  *Proposal:* `icontains` and `startsWith` operators (A–Z case-insensitive, escaped),
  on every store and allowed in `defineFilter`.
- **Criteria into Kysely.** Mixing a client filter with a Kysely query meant writing a
  small `whereOf(eb, criteriaTree(criteria))` in cooper. *Proposal:* export the
  stores' own translation from `newt-kit/kysely`.
- **Delete by criteria.** `Table` has no `deleteMany(criteria)`, and a soft-delete
  repository cannot hard-delete; purging a workspace needed Kysely, so only SQL stores.
- **Case-insensitive unique.** `TableOptions.unique` cannot say "whatever the case":
  that lives only in a SQL index, and a files store would not keep it.
- **Paging.** Lists that answer a whole array need an "every page" loop
  (`allPages(read)`); a list built from another cannot keep its cursor (`Page` with
  an explicit `nextCursor`); mapping a page is repeated everywhere (`mapPage`).

## Entities and saves

- **Values decided inside the save.** A card's number and position are known only
  under the guard; cooper creates the card with guesses, fixes them in `before` and
  records its event again. *Proposal:* a save that takes a factory run inside the
  transaction, or a documented "allocate in `before`" pattern.
- **Stale rows the save holds no version for.** Throwing `ConcurrencyConflict` from
  `after` to force a retry works but has no name. *Proposal:* a `conflict()` helper
  and a page in the docs.
- **Secret fields.** Every entity with a hash (user, client, grant, token,
  invitation) needs its own contract and a hand-written `toDTO` without it.
  *Proposal:* hidden fields, or a public schema next to the entity's.
- **A synchronous rule across two modules that would need each other** (a column can
  only be removed when it has no cards): cooper used `writesTo` plus a cleanup worker.
  The docs could show this pattern.

## Events and jobs

- **Filter before enqueueing.** `access.revoked` is told for every product, and each
  subscriber filters in its handler, so jobs are queued for events they ignore.
  *Proposal:* a `when` predicate in `subscribe`, checked before the job is written.
- **An event source as a port.** cooper writes `Pick<DomainEventEmitter<P>, 'subscribe'>`.
  *Proposal:* export `EventSource<P>` from `newt-kit/core`.
- **Queue name rules disagree** (a small bug): the emitter accepts an upper-case first
  letter that the job queue then refuses at startup. One shared pattern.
- **Running a use case as a worker in tests and scripts** needed a fake base that
  publishes events. *Proposal:* `jobs.runAsWorker(fn)` or a test helper.
- **"Does this scope still exist"** is a question every worker writing into a tenant
  must ask; cooper asks auth by hand in each one.
- **A handler sees only the payload**, not the event's id or time, so a reaction
  that must be idempotent by event (the card activity log) carries its own id in the
  payload. *Proposal:* `subscribe((payload, meta: { id, name, occurredAt }) => …)`.
- **The outbox's reads are too coarse.** `outbox.list()` returns every job, a week of
  done ones included, and `retry(id)` answers `false` without saying why. *Proposal:*
  `list({ status, limit, after })` and `get(id)`.
- **Messages cannot be put back.** `setMessages` is process-wide and returns nothing,
  so testing it needs a child process. *Proposal:* it returns a function that
  restores the previous messages.

## HTTP

- **CORS.** OPTIONS answers 405 and `serve` has no hook, so cooper wraps Bun's route
  table for MCP and OAuth. *Proposal:* a `cors` option per route or router.
- **Routes outside `/api`.** `/oauth`, `/mcp` and `/.well-known` cannot use the
  router's error handling or authentication: OAuth catches its own errors on every
  route, MCP sets its actor by hand. *Proposal:* routers mounted at the root, an
  `onError` per router or group, and a bearer `Authenticator` helper.
- **Health.** Every context writes `GET /api/health`. *Proposal:* `serve({ health: true })`,
  503 while stopping.
- **A group's own path** needs `group.patch('')`. Allow `'/'` or a `group.self`.
- **HTTP test helpers.** A free port and a cookie-jar client with manual redirects
  are repeated in every end-to-end test.

## Running an application

- **A served context.** Opening contexts, serving each with its frontend and extra
  routes, starting their workers and stopping them in reverse order on SIGINT is the
  same in nuke and in cooper. *Proposal:* `runContexts([...])`.
- **One tracer for the application.** Each base takes its own, so a request that
  crosses contexts is several traces. *Proposal:* an application-level tracer with
  span-name filtering.
- **Optional actor.** Code that runs both inside and outside a request needs a
  `currentActor()` that may return nothing.
- **Extending `Actor` is global:** a required field forces every `runAsActor` of every
  context to give it. Document optional fields, or a per-context actor type.
- **Mail.** Every application writes the same `Mailer` port and a console and a
  recording implementation. A tiny `newt/port-mail`.
- **Analytics.** The port only appends: cooper wrote a SQLite adapter and its reads.
  *Proposal:* an adapter, and a read side (`count`, `countBy` a field per day).
  Today an adapter must open its own transaction, since a module may not.

## Migrations

- **Edited migrations go unnoticed.** A migration is remembered by number and name; a
  checksum of its `up` file would refuse a rewritten one.
- **A context with no tables yet** needs a `.gitkeep`, because a missing migrations
  folder is an error.

## The frontend's side

- **A browser-safe entry.** The frontend shares the backend's `*.schema.ts`, which
  import `newt-kit/core`; its index creates an `AsyncLocalStorage` at load and breaks
  Vite's dev server (cooper aliases a stand-in). *Proposal:* `newt-kit/contract` with
  value objects, `defineFilter`, `Page`, `PageRequest` and the error body
  `{ error, code }` as a type.

## Tooling

- **newt-kit-eslint's preset cannot be scoped to a folder:** in a repository with a
  frontend, cooper rewrites the preset's `files`. *Proposal:* `newt({ files })`.
- **The `newt/*` alias** is repeated in each tsconfig and in Vite; the workspace
  package's `exports` would resolve it once.

## Beyond cooper

From the review of what a serious backend would need from newt, not yet asked by
cooper: OpenAPI generated from the routes' zod schemas, scheduled jobs (cron) on the
outbox, idempotency keys for POSTs, configuration validated with zod at startup, an
injectable clock for tests, an OpenTelemetry exporter, and a blob storage port with
its contract suite.

## Status (2026-10-26)

| Proposal | Status |
|---|---|
| Text search | Not in criteria: search belongs in a specialized adapter. The guide shows a search port of the application's own, with an adapter in memory and its contract. |
| Criteria into Kysely | Done: `whereOf(store, criteria)` in `newt-kit/kysely`. |
| Delete by criteria | Done: `Table.deleteMany`, and `purge` in `TableRepository`. |
| Case-insensitive unique | Discarded. |
| Paging | Done: `mapPage`, `allPages`, `Page.nextCursor`. |
| Values decided inside the save | Documented in the guide: allocate in `before`. |
| Stale rows | Done: `conflict()` in a repository. |
| Secret fields | Done: a public schema, which is all `toDTO` gives. |
| Synchronous rule across two modules | Documented in the guide. |
| Filter before enqueueing | Done: `when` in a subscription. |
| Event source as a port | Done: `EventSource<P>`. |
| Queue name rules | Fixed: one rule. |
| Running as a worker | Done: `jobs.runAsWorker(fn)`. |
| Does this scope still exist | Discarded. |
| Handler metadata | Done: `subscribe((payload, meta) => …)`. |
| Outbox reads | Done: `list({ status, after, limit })` and `get(id)`. |
| Messages put back | Done: `setMessages` gives back a restore function. |
| CORS | Done: a `cors` option per router, group or route. |
| Routes outside `/api` | Done: root routers, `onError`, `bearerAuthenticator`. |
| Health | Done: `serve({ health })`, 503 while stopping. |
| A group's own path | Discarded: `''` already does it. |
| HTTP test helpers | Done: `newt-kit/testing`. |
| A served context | Done: `runContexts` in `newt-kit/application`. |
| One tracer | Done: `setTracer`, `filterSpans`. |
| Optional actor | Done: `findCurrentActor()`. |
| Extending `Actor` | Documented in the guide. |
| Mail | Later. |
| Analytics | Later. |
| Migration checksums | Done. |
| A context with no tables yet | Discarded: a missing folder stays an error. |
| A browser-safe entry | Done: `newt-kit/contract`. |
| eslint `files` | Done: `newt({ files })`. |
| The `newt/*` alias | Done: resolved through the package's `exports`. |
| OpenAPI | Later. |
| Cron | Done: `base.schedules.define(name, cron)`, an event source outside the outbox. |
| Idempotency keys | Done: an `idempotency` option on POST routes. |
| Configuration with zod | Discarded. |
| Injectable clock | Done: `clock` in `BaseOptions`. |
| OpenTelemetry exporter | Done: `newt-kit/otel`. |
| Blob storage port | Later. |

## Epics (2026-11-01)

From the review of what a public SaaS needs from newt. Each deliverable is its own
branch, merged into `main`.

### Rate limiting (`rate-limit/*`): done

| # | Deliverable | Status |
|---|---|---|
| 1 | `newt-kit/port-rate-limit` (sliding window, contract suite): in memory, on a `Table`, on Redis (`newt-kit/adapter-redis`) | Done |
| 2 | `base.rateLimits.define` for use cases; `TooManyRequests` (429, `Retry-After`) | Done |
| 3 | `rateLimit` on routers, groups and routes, adding up; by actor, address or key; `serve({ trustProxy })`, `clientIp` | Done |
| 4 | Each take a `rate-limit` step of its trace; newt-monitor draws them | Done |
| 5 | cooper: API, sign-in, sign-up, invitations, OAuth and MCP limits; `COOPER_TRUST_PROXY` | Done |

### HTTP hardening (`http-hardening/*`): done

| # | Deliverable | Status |
|---|---|---|
| 1 | Security headers on every answer (`securityHeaders`, `hsts`); `no-store` on the API | Done |
| 2 | The built frontend's Content-Security-Policy (`csp`), inline scripts by their hashes | Done |
| 3 | `maxBodyBytes` per route, group and router (413); `serve({ maxBodyBytes, idleTimeoutSeconds })` | Done |
| 4 | Writes from pages of other origins refused (403 `cross_origin_refused`) unless `cors` or `crossOrigin` | Done |
| 5 | `setSessionCookie` / `clearSessionCookie`; cooper uses them | Done |

Not done, on purpose: the guide and the reference say nothing of them yet.
