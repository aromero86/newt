# Dead jobs and analytics

The backoffice can show every workspace and every account. Two things are missing
for the staff to look after cooper.

**Jobs that died.** A `handler`'s job runs again until it succeeds, up to its
attempts. One that fails every time is marked dead, with its last error, and waits
([chapter 12](./12-failures)). Something must be fixed first (a mail server, a bug),
and then someone must put it back. Each context keeps its jobs in its own store, and
since chapter 12 each one has an `outbox` module with two use cases for them, `dead`
and `retry`, and no routes: they were waiting for the staff.

**Numbers.** How many cards were made each day, how many workspaces opened, how many
people signed up. You could count them in auth and boards each time. But a count over
all of cooper, by day, is the kind of query that grows with the data, and it would run
on the databases that serve the people using cooper.

This chapter adds the backoffice's two last modules:

- **`job`**: every context's dead jobs, listed and retried, each through that
  context's own outbox use cases.
- **`metric`**: cooper's numbers, a projection fed by workers on auth's and boards'
  events and kept with newt's **analytics port**, `Analytics`, which only appends. Its
  adapter is cooper's own, `SqlAnalytics`, on Kysely. newt brings the port's contract,
  `describeAnalyticsContract`, which the adapter passes, and `MemoryAnalytics`, an
  adapter in memory for tests.

With the API whole, the backoffice gets its frontend, copied from the repository, and
the seed makes its first staff account.

## Dead jobs, from every context

### The outbox port, seen from outside

A store keeps its jobs in its **outbox**, newt's port `Outbox` from `newt/port-outbox`,
at `base.store.outbox`. Its worker uses most of it (`claim`, `close`, `renew`). Three
of its methods are for whoever looks after the jobs:

```ts
// packages/newt/port-outbox/outbox.ts
  /**
   * Puts a dead job back to wait, as new: no attempts, due now. For whoever fixed
   * what killed it. Whether it was dead and is now waiting: a job in any other state,
   * or none with that id, is left as it is.
   */
  retry(id: string): Promise<boolean>
// …
  /**
   * The jobs it keeps, oldest first (by `createdAt`, then `id`), all of them or those
   * `query` says: for whoever looks after them (an admin page, a test).
   */
  list(query?: JobQuery): Promise<Job[]>
  /** One job, by its id; none if it is not kept. */
  get(id: string): Promise<Job | undefined>
```

- **`list({ status: 'dead' })`** reads the dead ones. A `JobQuery` also takes `after`
  and `limit` to read page by page.
- **`retry(id)`** puts a dead job back to wait, with all its attempts, due now. It
  answers `false` for a job that is not dead: one pending or running is on its way,
  one done is done, and running it again would do it twice.
- **`get(id)`** reads one, to say why a retry did nothing.

cooper's `Outbox_Module` ([chapter 12](./12-failures)) is these three, as use cases:
`dead(page)` lists with `list`, newest first, and `retry(id)` calls `retry` and, when
it answers `false`, asks `get` whether the job is missing (`outbox.job_not_found`, a
404) or not dead (`outbox.job_not_dead`, a 409).

The backoffice cannot read auth's outbox itself: that would be reaching into another
context's store, which a `Pick` of auth's modules does not even allow. So it is handed
each context's `outbox` **module**, as it was handed `tenant` and `card` in [chapter
25](./25-backoffice).

### Which contexts

The `job` module names the contexts whose jobs the staff look after. Create
`modules/job/job.schema.ts` in the backoffice:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.schema.ts
import { z } from 'zod'
import type { DeadJobDTO } from '../../../../shared/outbox/outbox.schema'

/** The contexts whose jobs the staff look after: each one runs its own. */
export const JOB_CONTEXTS = ['auth', 'boards', 'backoffice'] as const

export const JobContextSchema = z.enum(JOB_CONTEXTS)

export type JobContext = z.infer<typeof JobContextSchema>

/** A dead job of a context, as the staff's page lists it. */
export type ContextJobDTO = DeadJobDTO & { context: JobContext }
```

`JOB_CONTEXTS` is a list of names, and `JobContextSchema` refuses any other: a route
that takes the context from its path cannot be asked for `nowhere`. A dead job as the
page lists it is chapter 12's `DeadJobDTO`, with its context.

### What it is given

```ts
// cooper/backend/contexts/backoffice/modules/job/job.deps.ts
import type { Outbox_Module } from '../../../../shared/outbox/outbox.module'
import type { Staff_Module } from '../staff/staff.module'
import type { JobContext } from './job.schema'

export interface Job_Deps {
  /** That who asks is of the staff, before any route answers. */
  staff: Staff_Module
  /** Each context's jobs, through the use cases it offers for them: auth's, boards' and the backoffice's own. */
  outboxes: Record<JobContext, Outbox_Module>
}
```

`outboxes` is a record by context: one `Outbox_Module` for each of auth, boards and
the backoffice itself.

### The routes

```ts
// cooper/backend/contexts/backoffice/modules/job/job.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Job_Deps } from './job.deps'
import type { Job_Module } from './job.module'
import type { JobContext } from './job.schema'

export function registerJobRoutes(base: CooperBase, jobs: Job_Module, deps: Job_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `/jobs/boards`: boards' dead jobs. A context that is not one is a 400.
  routes.get('/jobs/:context', async request =>
    Response.json(await jobs.dead(request.params.context as JobContext, pageRequestFrom(request))))

  routes.post('/jobs/:context/:jobId/retry', async request => {
    await jobs.retry(request.params.context as JobContext, request.params.jobId)
    return new Response(null, { status: 204 })
  })
}
```

The context comes from the path as a string; the cast only tells TypeScript what the
use case checks. A context that is not one fails `JobContextSchema.parse`, which the
router answers as a 400, as any invalid input.

### The module

```ts
// cooper/backend/contexts/backoffice/modules/job/job.module.ts
import { Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { Job_Deps } from './job.deps'
import { registerJobRoutes } from './job.routes'
import { JobContextSchema, type ContextJobDTO, type JobContext } from './job.schema'

/**
 * The jobs that died in each context of cooper: a reaction that failed
 * every attempt waits, with its last error, for someone to look. The staff see them
 * here and, once what killed one is fixed, put it back to run. Each context keeps
 * and runs its own jobs: this module only asks each one, through its use cases.
 */
export class Job_Module extends Module {

  static initialize(base: CooperBase, deps: Job_Deps): Job_Module {
    const module = new Job_Module(base, deps)
    registerJobRoutes(base, module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: Job_Deps) {
    super('job', base.invocations)
  }

  /** A page of a context's dead jobs, the newest first. */
  @UseCase()
  async dead(context: JobContext, page: PageRequest): Promise<Page<ContextJobDTO>> {
    const name = JobContextSchema.parse(context)
    const found = await this.deps.outboxes[name].dead(page)
    return { ...found, items: found.items.map(job => ({ ...job, context: name })) }
  }

  /**
   * A dead job of a context runs again: what a person of the staff asks for, at once,
   * once they fixed what killed it. The context's own use case puts it back; its
   * worker runs it. No `writesTo`, not even for the backoffice's own outbox: the
   * write rule watches what repositories save, and a job put back is the store's
   * outbox, written by `outbox.retry` in one step.
   */
  @UseCase()
  async retry(context: JobContext, id: string): Promise<void> {
    await this.deps.outboxes[JobContextSchema.parse(context)].retry(id)
  }
}
```

It keeps nothing and runs nothing. `dead` asks the context's outbox module for a page
and marks each job with its context; `retry` asks it to put one back. The context's
own worker runs it, as it runs every job of its store.

Why no `writesTo`? Retrying one of auth's or boards' jobs calls another context's use
case: that is the root of what happens there ([chapter 25](./25-backoffice)), and the
write rule has nothing to say here. Retrying one of the backoffice's own jobs calls
`outbox.retry` in the same context, and still writes no module's rows: the rule
checks what repositories save, and `outbox.retry` saves nothing through one. It is a
single write to the store's outbox, the table the job died in, so a failure leaves
nothing halfway, and there is nothing for `writesTo` to declare.

The backoffice's own outbox holds no job yet: none of its modules reacts to the
backoffice's own events. It is listed so that the day one does, its dead jobs are on
the same page.

## Analytics: a port that only appends

The numbers are a **projection**: a copy of the data, made for reading. The truth
stays in auth and boards, with their transactions. Workers follow their events and
append a row for each thing that happened. The copy is a moment behind, and never in
the way of what it counts.

newt defines a port for such data, `Analytics`, in `newt/port-analytics`:

```ts
// packages/newt/port-analytics/analytics.ts
/**
 * Where analytical data goes: a database made for reading a lot at once (ClickHouse,
 * DuckDB), not for saving entities. It is only ever added to: a row, once in, never
 * changes or goes; what changes later is a new row telling it.
 *
 * It has no transactions, so it is never a context's store: it is fed by `handler`
 * workers, after the events of what the store saved. A worker may run twice, so a row
 * carries an id of its own (the event's, the order line's): one already in is not
 * added again.
 *
 * Reading is each adapter's own: analytical queries are its database's language.
 */
export interface Analytics {
  /** Adds rows to a dataset; a row whose id is already there is left out. */
  append(dataset: string, rows: AnalyticsRow[]): Promise<void>
  close(): Promise<void>
}
```

A row is anything with an id:

```ts
// packages/newt/port-analytics/analytics-row.ts
/** A row of an analytical dataset: anything, with an id that makes it unique. */
export type AnalyticsRow = { id: string, [field: string]: unknown }
```

What the port promises:

- **Rows are only added.** A row, once in, never changes or goes. Something that
  changes later is a new row saying so.
- **Every row has an id**, and a row whose id is already in its dataset is left out.
  A worker that runs twice counts once.
- **No transactions**, so it is never a context's store. It is fed by `handler`
  workers, after the save whose event they follow.
- **Reading is each adapter's own.** Analytical queries (group by day, by month, top
  ten) are in the database's own language, so the port does not try to say them.

newt brings no adapter for a real analytical database yet. It brings
`MemoryAnalytics`, for tests, and the suite that checks an adapter,
`describeAnalyticsContract`, both in `newt/port-analytics/contract`.

### cooper's questions

Reading is not in the port, so cooper declares the questions it asks in an interface
of its own. The module that reads takes this, and does not know which adapter answers.
Create `shared/analytics/analytics-counts.ts`:

```ts
// cooper/backend/shared/analytics/analytics-counts.ts
/** How many rows of a dataset have one value of a field. */
export type AnalyticsCount = { value: string, count: number }

/**
 * The questions cooper asks its analytics. newt's port only appends: reading is each
 * adapter's own, in its database's language. A module that reads them takes this, so
 * it does not know which adapter answers.
 */
export interface AnalyticsCounts {
  /** How many rows a dataset has. */
  count(dataset: string): Promise<number>
  /**
   * How many rows of a dataset have each value of a field, in the order of the values,
   * from one on (`from`, compared as text: a day such as `2026-10-01`, a month).
   */
  countBy(dataset: string, field: string, options?: { from?: string }): Promise<AnalyticsCount[]>
}
```

Two questions are enough for an overview: how many rows a dataset has, and how many
have each value of a field, from one value on (`countBy('card_created', 'day', { from:
'2026-10-01' })`: the cards of each day since October 1st).

### Its table

cooper keeps its analytics in the context's own SQL database, for an application
whose numbers are small enough for it. One table holds every dataset, each row whole
as JSON. The migration lives with the adapter, in `shared/analytics`, and a context
that keeps analytics copies it, as with the web session's:

```sql
-- cooper/backend/shared/analytics/migrations/sqlite/00001_analytics_up.sql
-- Analytics in the context's own database (shared/analytics): every dataset's rows
-- in one table, each one whole as JSON. A context that keeps its analytics there
-- copies this migration into its own, numbered after the ones it has. Rows are only
-- ever added: one whose id is already in its dataset is left out (`ON CONFLICT DO NOTHING`).
CREATE TABLE analytics_row (
  dataset TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);
```

```sql
-- cooper/backend/shared/analytics/migrations/sqlite/00001_analytics_down.sql
DROP TABLE analytics_row;
```

The primary key `(dataset, id)` is the port's promise in the schema: a row whose id
is in already cannot be added twice.

### `SqlAnalytics`, on Kysely

The adapter implements newt's port and cooper's questions. Its queries are Kysely's,
run on the store's connection with `kyselyFor`, as boards' counts were in [chapter
15](./15-kysely). Create `shared/analytics/sql-analytics.ts`:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
import { sql, type RawBuilder } from 'kysely'
import type { SqliteStore } from 'newt/adapter-sqlite'
import { kyselyFor } from 'newt/kysely'
import type { Analytics, AnalyticsRow } from 'newt/port-analytics'
import type { AnalyticsCount, AnalyticsCounts } from './analytics-counts'

/** A field of a row, as a query names it: letters, digits and `_`, never a piece of SQL. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Its one table, as Kysely queries it: each row whole, as JSON text. */
type AnalyticsDatabase = {
  analytics_row: { dataset: string, id: string, data: string }
}

/**
 * newt's analytics port on the context's own SQL database, SQLite, for an
 * application whose numbers are small enough for it: newt brings no adapter yet
 * (ClickHouse and DuckDB will come). Every dataset is in one table, `analytics_row`,
 * each row whole as JSON, in the database of the context that reads it: it copies
 * `migrations/sqlite/00001_analytics_up.sql` into its own. Its queries are Kysely's.
 *
 * It keeps the port's promises (`describeAnalyticsContract`): rows are only added, and
 * one whose id is in already is left out, so the worker that appends may run twice.
 * Each append is a transaction of its own, as a mailer's send is a call of its own: it
 * is fed by `handler` workers, never inside the save of an entity.
 */
export class SqlAnalytics implements Analytics, AnalyticsCounts {

  private readonly db

  constructor(private readonly store: SqliteStore) {
    this.db = kyselyFor<AnalyticsDatabase>(store)
  }

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.store.transaction(async () => {
      await this.db.insertInto('analytics_row')
        .values(rows.map(row => ({ dataset, id: row.id, data: JSON.stringify(row) })))
        .onConflict(conflict => conflict.columns(['dataset', 'id']).doNothing())
        .execute()
    })
  }

  /** A dataset's rows, by id. */
  async rows(dataset: string): Promise<AnalyticsRow[]> {
    const found = await this.db.selectFrom('analytics_row').select('data').where('dataset', '=', dataset).orderBy('id').execute()
    return found.map(row => JSON.parse(row.data) as AnalyticsRow)
  }

  async count(dataset: string): Promise<number> {
    const found = await this.db.selectFrom('analytics_row').select(eb => eb.fn.countAll<number>().as('count')).where('dataset', '=', dataset).executeTakeFirstOrThrow()
    return Number(found.count)
  }

  async countBy(dataset: string, field: string, options: { from?: string } = {}): Promise<AnalyticsCount[]> {
    if (!FIELD.test(field)) throw new Error(`'${field}' is not a field a row may have`)
    const value = this.fieldOf(field)
    const found = await this.db.selectFrom('analytics_row')
      .select(eb => [value.as('value'), eb.fn.countAll<number>().as('count')])
      .where('dataset', '=', dataset)
      .where(value, '>=', options.from ?? '')
      .groupBy(value)
      .orderBy(value)
      .execute()
    return found.map(row => ({ value: String(row.value), count: Number(row.count) }))
  }

  /** The store is the context's, which closes it: there is nothing of its own to close. */
  async close(): Promise<void> {}

  /**
   * A field of the JSON, as text: each database says it its own way (DuckDB or
   * ClickHouse would read a column). It is a name, checked above, never a piece of SQL.
   */
  private fieldOf(field: string): RawBuilder<string> {
    return sql<string>`json_extract(data, ${sql.lit(`$.${field}`)})`
  }
}
```

- **`append`** inserts the rows with `ON CONFLICT (dataset, id) DO NOTHING`: a row
  whose id is in already, or twice in the same append, is left out. It runs in a
  transaction of its own (`store.transaction`), as a mailer's send is a call of its
  own: the workers that feed it are never inside the save of an entity.
- **`rows`** reads a dataset back, by id: what the contract suite needs to check it.
- **`count`** and **`countBy`** are cooper's questions. `countBy` groups by a field of
  the JSON, read with `json_extract`. That is SQLite's way of saying it, so it is in
  one place, `fieldOf`, which says so; [chapter 27](./27-postgres) gives Postgres its
  own. A field name goes into the SQL as a literal, so it must be a name and nothing
  else: `FIELD` refuses anything that is not letters, digits and `_` before any query
  is built.
- **`close`** has nothing to do: the store is the context's, and the context closes
  it.

It takes a `SqliteStore` for now. Chapter 27 opens it to any SQL store.

### The contract

An adapter keeps the port's promises or it is not one. newt writes them down as a
suite, `describeAnalyticsContract`, as it does for stores (`describeStoreContract`) and
as you did for the card search in [chapter 16](./16-search-port). It takes a name and
a fixture: how to open fresh, empty analytics, and how to read a dataset back, since
the port itself cannot read. Its tests check that rows are kept each in its dataset,
that a row whose id is in already is never added, that the first row of an id stays
unchanged, and that an id repeated in one append is kept once.

`MemoryAnalytics` passes the same suite in newt's own tests. It keeps each dataset in
a map by id, and has a `rows(dataset)` of its own for the fixture. A module's test that
needs analytics, and not a database, can hand it one.

Run the suite on `SqlAnalytics`, with a store of its own in memory that has only the
analytics table, and add a test of cooper's questions:

```ts
// cooper/backend/shared/analytics/sql-analytics.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { describeAnalyticsContract } from 'newt/port-analytics/contract'
import { SqlAnalytics } from './sql-analytics'

/** A store of its own, in memory, with the analytics table and nothing else. */
const openStore = () => SqliteStore.open({ path: ':memory:', migrations: join(import.meta.dir, 'migrations/sqlite') })

const stores: SqliteStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()))
})

async function open(): Promise<SqlAnalytics> {
  const store = await openStore()
  stores.push(store)
  return new SqlAnalytics(store)
}

describeAnalyticsContract('SqlAnalytics', {
  open,
  rows: (analytics, dataset) => analytics.rows(dataset),
})

describe('SqlAnalytics', () => {
  test('counts a dataset, and its rows by the value of a field, from one on', async () => {
    const analytics = await open()
    await analytics.append('card_created', [
      { id: 'c1', day: '2026-10-01' },
      { id: 'c2', day: '2026-10-03' },
      { id: 'c3', day: '2026-10-03' },
      { id: 'c4', day: '2026-09-30' },
    ])
    await analytics.append('workspace_created', [{ id: 'w1', day: '2026-10-03' }])

    expect(await analytics.count('card_created')).toBe(4)
    expect(await analytics.countBy('card_created', 'day', { from: '2026-10-01' })).toEqual([
      { value: '2026-10-01', count: 1 },
      { value: '2026-10-03', count: 2 },
    ])
    expect(await analytics.countBy('nothing', 'day')).toEqual([])
  })

  test('never takes a field that is not a name', async () => {
    const analytics = await open()
    await expect(analytics.countBy('card_created', 'day\') OR 1=1 --')).rejects.toThrow('is not a field')
  })
})
```

The last test is the guard on `FIELD`: a field that tries to be SQL is refused before
it reaches the database.

## The metric module

### What it counts

Three datasets, one row for each thing that happened, by its id. And the overview the
staff see: totals, and each of the last days. Create `modules/metric/metric.schema.ts`:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.schema.ts
/** How many things happened on one day (`2026-10-26`, UTC). */
export type DayCountDTO = { day: string, count: number }

/** cooper's numbers, as the staff's overview shows them: from the analytics, a moment behind. */
export type MetricsOverviewDTO = {
  /** Every one there has ever been. */
  totals: {
    cards: number
    workspaces: number
    signUps: number
  }
  /** The last days, today last, one entry for each day, those with none too. */
  cardsPerDay: DayCountDTO[]
  workspacesPerDay: DayCountDTO[]
  signUpsPerDay: DayCountDTO[]
}

/** The datasets of the analytics the backoffice feeds, one row for each thing that happened, by its id. */
export const METRIC_DATASETS = {
  cardCreated: 'card_created',
  workspaceCreated: 'workspace_created',
  userSignedUp: 'user_signed_up',
} as const
```

### What it is given

Its options are where the numbers are kept, and how many days the overview shows. The
analytics are typed as both the port and cooper's questions: the workers append, the
overview reads:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric-options.ts
import type { Analytics } from 'newt/port-analytics'
import type { AnalyticsCounts } from '../../../../shared/analytics/analytics-counts'

/** What the context configures the metrics with. */
export type Metric_Options = {
  /** Where they are kept: appended to by the workers, read by the overview. */
  analytics: Analytics & AnalyticsCounts
  /** How many days the overview goes back, today included. */
  days: number
}
```

Its deps are the modules whose events it counts, in auth and boards, and the staff for
the routes:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.deps.ts
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'
import type { Card_Module } from '../../../boards/modules/card/card.module'
import type { Staff_Module } from '../staff/staff.module'

/** The modules whose events the metrics count, in auth and boards; and the staff, for the routes. */
export interface Metric_Deps {
  staff: Staff_Module
  /** `card.created`. */
  card: Card_Module
  /** `tenant.created`: a new workspace. */
  tenant: Tenant_Module
  /** `user.signedUp`. */
  user: AuthUser_Module
}
```

### The workers

Each number follows an event of another context:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.workers.ts
import type { Metric_Deps } from './metric.deps'
import type { Metric_Module } from './metric.module'

/**
 * What the metrics count, each from an event of another context: a `handler`, a job
 * saved with what happened, in that context's outbox and run by its worker until it
 * succeeds. Not `fire-and-forget`: a number lost when the server stops would be wrong
 * for good. Each one appends a row by the id of what it counts, so running it twice
 * counts once.
 */
export function registerMetricWorkers(metrics: Metric_Module, deps: Metric_Deps): void {
  deps.card.events.created.subscribe(card => metrics.recordCard(card), {
    strategy: 'handler',
    queue: 'metric.recordCard.on.card.created',
  })
  deps.tenant.events.created.subscribe(tenant => metrics.recordWorkspace(tenant), {
    strategy: 'handler',
    queue: 'metric.recordWorkspace.on.tenant.created',
  })
  deps.user.events.signedUp.subscribe(user => metrics.recordSignUp(user), {
    strategy: 'handler',
    queue: 'metric.recordSignUp.on.user.signedUp',
  })
}
```

Each is a `handler`, not `fire-and-forget`. A job is saved with what happened, in the
same transaction, and runs until it succeeds. A number lost when the server stops
would be wrong for good, and nothing would ever fix it.

Notice where these jobs live. A subscription's job is written in the store of the save
that tells the event ([chapter 13](./13-another-context)). `card.created` is told in
boards' store, so the job of `metric.recordCard.on.card.created` is in **boards'**
outbox, run by boards' worker. The jobs for `tenant.created` and `user.signedUp` are
in **auth's**. The backoffice's own outbox holds none of them. So a metric job that
dies is on boards' or auth's page of dead jobs, and a test waits for auth's and
boards' workers to see the numbers.

The queue names follow [chapter 11](./11-reacting)'s rule, `<module that
reacts>.<use case it calls>.on.<module that tells>.<event>`, and `newt/queue-name`
checks them.

### The module

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.module.ts
import { Module, now, UseCase } from 'newt/core'
import type { TenantDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import type { CardDTO } from '../../../boards/modules/card/card.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { Metric_Deps } from './metric.deps'
import type { Metric_Options } from './metric-options'
import { registerMetricRoutes } from './metric.routes'
import { METRIC_DATASETS, type DayCountDTO, type MetricsOverviewDTO } from './metric.schema'
import { registerMetricWorkers } from './metric.workers'

const DAY_MS = 24 * 60 * 60_000

/** The day of a moment, in UTC: `2026-10-26`. */
const dayOf = (iso: string) => iso.slice(0, 10)

/**
 * cooper's numbers: cards made, workspaces opened, people signed up. They are a
 * projection: the truth lives in auth and boards, with their transactions;
 * workers follow their events and append a row for each to the analytics, which
 * this module reads back added up. It is a moment behind, and never in the way of
 * what it counts.
 */
export class Metric_Module extends Module {

  static initialize(base: CooperBase, deps: Metric_Deps, options: Metric_Options): Metric_Module {
    const module = new Metric_Module(base, options)
    registerMetricRoutes(base, module, deps)
    registerMetricWorkers(module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly options: Metric_Options) {
    super('metric', base.invocations)
  }

  /** A card was made, in a board of a workspace. */
  @UseCase()
  async recordCard(card: CardDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.cardCreated, [{ id: card.id, workspaceId: card.workspaceId, day: dayOf(card.createdAt) }])
  }

  /** A workspace was made. */
  @UseCase()
  async recordWorkspace(tenant: TenantDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.workspaceCreated, [{ id: tenant.id, day: dayOf(tenant.createdAt) }])
  }

  /** Someone made an account. */
  @UseCase()
  async recordSignUp(user: UserDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.userSignedUp, [{ id: user.id, day: dayOf(user.createdAt) }])
  }

  /** The totals, and each of the last days, today included. */
  @UseCase()
  async overview(): Promise<MetricsOverviewDTO> {
    const days = this.lastDays()
    const { analytics } = this.options
    const [cards, workspaces, signUps, cardsPerDay, workspacesPerDay, signUpsPerDay] = await Promise.all([
      analytics.count(METRIC_DATASETS.cardCreated),
      analytics.count(METRIC_DATASETS.workspaceCreated),
      analytics.count(METRIC_DATASETS.userSignedUp),
      this.perDay(METRIC_DATASETS.cardCreated, days),
      this.perDay(METRIC_DATASETS.workspaceCreated, days),
      this.perDay(METRIC_DATASETS.userSignedUp, days),
    ])
    return { totals: { cards, workspaces, signUps }, cardsPerDay, workspacesPerDay, signUpsPerDay }
  }

  /** How many rows of a dataset each day has, a day with none too. */
  private async perDay(dataset: string, days: string[]): Promise<DayCountDTO[]> {
    const counts = new Map((await this.options.analytics.countBy(dataset, 'day', { from: days[0] })).map(each => [each.value, each.count]))
    return days.map(day => ({ day, count: counts.get(day) ?? 0 }))
  }

  /** The days the overview shows, the oldest first and today last. */
  private lastDays(): string[] {
    const today = now().getTime()
    return Array.from({ length: this.options.days }, (_, index) => dayOf(new Date(today - (this.options.days - 1 - index) * DAY_MS).toISOString()))
  }
}
```

- **`recordCard`, `recordWorkspace`, `recordSignUp`** append one row each, whose id is
  the id of what it counts. A worker that runs twice appends the same id twice, and
  the second is left out. The row keeps the day it happened, from the entity's own
  `createdAt`, in UTC: a job run late still counts on the right day.
- **`overview`** asks for the three totals and the three series at once, six queries
  side by side.
- **`perDay`** fills the days with none: `countBy` answers only the days that have
  rows, and a chart wants every day.
- **`lastDays`** tells the time by **`now()`** from `newt/core`, the context's clock
  ([chapter 19](./19-invitations-and-time)), not `Date.now()`: a test that moves the
  clock sees the days move.

These use cases are called from workers and write no repository, so the write rule
has nothing to check: an append is not a save of an entity.

### The route

One route, behind the same check as every other:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.routes.ts
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Metric_Deps } from './metric.deps'
import type { Metric_Module } from './metric.module'

export function registerMetricRoutes(base: CooperBase, metrics: Metric_Module, deps: Metric_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  routes.get('/metrics', async () => Response.json(await metrics.overview()))
}
```

## Wiring

### The analytics table in the backoffice's database

The backoffice keeps its analytics in its own database. Copy the migration into its
folder, numbered after the session's:

```sql
-- cooper/backend/contexts/backoffice/migrations/sqlite/00002_analytics_up.sql
-- Analytics in the context's own database (shared/analytics): every dataset's rows
-- in one table, each one whole as JSON. A context that keeps its analytics there
-- copies this migration into its own, numbered after the ones it has. Rows are only
-- ever added: one whose id is already in its dataset is left out (`ON CONFLICT DO NOTHING`).
CREATE TABLE analytics_row (
  dataset TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);
```

```sql
-- cooper/backend/contexts/backoffice/migrations/sqlite/00002_analytics_down.sql
DROP TABLE analytics_row;
```

Its database now keeps more than sessions. In `backoffice.context.ts`, the comment
says so:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.ts
// …
/**
 * The staff's console: it reads `auth` and `boards`, and changes them only through
 * their use cases. Only the staff (access to the `backoffice` app in `auth`) enter it.
 * Its own database keeps its web sessions and its analytics.
 */
// …
```

### The modules

`initialize-modules.ts` gains the outboxes in its deps, and three modules: `metric`,
the backoffice's own `outbox`, and `job`. The whole file:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
import { SqlAnalytics } from '../../shared/analytics/sql-analytics'
import type { CooperBase } from '../../shared/cooper-base'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { PRODUCTS, WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
import type { Boards_Modules } from '../boards/initialize-modules'
import type { Backoffice_Config } from './backoffice-config'
import { Job_Module } from './modules/job/job.module'
import { Metric_Module } from './modules/metric/metric.module'
import { Staff_Module } from './modules/staff/staff.module'
import { User_Module } from './modules/user/user.module'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * What `backoffice`'s modules are given besides its base: the use cases of the
 * contexts it reads, those it needs and nothing else. Never a context's base nor its
 * store: another context is reached through its use cases and its events.
 */
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
  boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
}

/** How many days the metrics' overview goes back, today included. */
const METRIC_DAYS = 30

/**
 * Every module of `backoffice`, each one after the modules it uses. They read auth and
 * boards through their modules' use cases, and keep only their sessions and their
 * analytics, in the context's own database.
 */
export function initializeModules(base: CooperBase, config: Backoffice_Config, deps: Backoffice_ModuleDeps) {
  const { auth, boards } = deps

  const staff = Staff_Module.initialize(base, { user: auth.user, access: auth.access }, { productId: PRODUCTS.backoffice })
  const session = WebSession_Module.initialize(base, {
    context: 'backoffice',
    clientId: PRODUCTS.backoffice,
    clientSecret: config.clientSecret,
    publicUrl: config.publicUrl,
    authUrl: config.authPublicUrl,
    days: config.sessionDays,
    identify: accessToken => auth.token.verify(accessToken),
    // `{ user }`, as every web app reads its session; only for the staff: anyone else,
    // an access taken away since signing in, gets a 403.
    profile: async () => ({ user: await staff.me() }),
  })
  const user = User_Module.initialize(base, { staff, user: auth.user, access: auth.access, tenant: auth.tenant }, { workspacesProduct: WORKSPACES_PRODUCT })
  const workspace = Workspace_Module.initialize(base, { staff, tenant: auth.tenant, access: auth.access, user: auth.user, board: boards.board, card: boards.card })
  const metric = Metric_Module.initialize(base, { staff, card: boards.card, tenant: auth.tenant, user: auth.user }, {
    analytics: new SqlAnalytics(base.store),
    days: METRIC_DAYS,
  })
  const outbox = Outbox_Module.initialize(base)
  // Each context's dead jobs, through its own use cases.
  const job = Job_Module.initialize(base, { staff, outboxes: { auth: auth.outbox, boards: boards.outbox, backoffice: outbox } })
  return { session, staff, user, workspace, metric, outbox, job }
}

export type Backoffice_Modules = ReturnType<typeof initializeModules>
```

- `Backoffice_ModuleDeps` picks `outbox` from auth's modules and from boards'. Both
  have had it since chapter 12 and chapter 17. `openContexts` passes their modules
  whole already, so it does not change.
- `metric` gets its analytics: `SqlAnalytics` over the backoffice's own store
  (`base.store`), and 30 days.
- `outbox` is the backoffice's own `Outbox_Module`, over its own store, initialized as
  auth and boards initialize theirs.
- `job` gets the three outboxes, by context name. The record's keys are checked
  against `JobContext`: a context added to `JOB_CONTEXTS` without its outbox here does
  not compile.

## Tests

### Waiting for the metrics

`settled` in `open-test-backoffice.ts` already waits for auth's jobs, then boards'.
That is exactly where the metric jobs are. Its comment says so now:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
// …
    /**
     * Until the background work is done, in the order it flows: auth's events (heard
     * by boards and by the metrics), then boards' (the cards the metrics count).
     */
// …
```

### The jobs

The test makes a reaction of its own fail, with one attempt, while "the mail server
is down". Then it finds the job dead, fixes the cause, retries it, and checks it ran.
Create `modules/job/job.test.ts`:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('job', () => {
  let t: TestBackoffice
  let sam: UserDTO

  beforeEach(async () => {
    t = await openTestBackoffice()
    sam = await t.staffMember('Sam')
  })

  afterEach(() => t.close())

  test('a job of boards that dies is listed with its last error, retried, and then done', async () => {
    const tenant = await t.as(sam, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    await t.settled()
    // A reaction to boards' cards that fails while the "mail server" is down, at its only attempt.
    // It is the test's own, of no module: its queue names none.
    let down = true
    t.boards.modules.card.events.created.subscribe(() => {
      if (down) throw new Error('the mail server is down')
    // eslint-disable-next-line newt/queue-name
    }, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
    await t.board(sam, tenant.id, 'Roadmap', ['One'])
    await t.settled()

    const dead = await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))
    expect(dead.items).toEqual([expect.objectContaining({
      context: 'boards',
      queue: 'test.tellSomeone.on.card.created',
      event: 'card.created',
      attempts: 1,
      lastError: expect.stringContaining('the mail server is down'),
    })])
    expect((await t.as(sam, () => t.modules.job.dead('auth', { size: 10 }))).items).toEqual([])

    down = false
    await t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))
    await t.settled()

    expect((await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))).total).toBe(0)
    const jobs = await t.boards.base.store.outbox.list()
    expect(jobs.find(job => job.id === dead.items[0]!.id)?.status).toBe('done')
    // Done is done: it is not run again.
    await expect(t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))).rejects.toMatchObject({ code: 'outbox.job_not_dead', status: 409 })
  })

  test('a job that is not there, or a context that is not one, is refused', async () => {
    await expect(t.as(sam, () => t.modules.job.retry('auth', '0190a0a0-0000-7000-8000-000000000000'))).rejects.toMatchObject({ code: 'outbox.job_not_found', status: 404 })
    // The backoffice's own outbox, in the same context, is reached the same way.
    await expect(t.as(sam, () => t.modules.job.retry('backoffice', '0190a0a0-0000-7000-8000-000000000000'))).rejects.toMatchObject({ code: 'outbox.job_not_found', status: 404 })
    await expect(t.as(sam, () => t.modules.job.dead('nowhere' as 'auth', { size: 10 }))).rejects.toThrow()
  })
})
```

The subscription is the test's own, on boards' emitter: its job goes to boards'
outbox like any reaction of boards. Its queue names no module of cooper, so the test
turns the queue-name rule off for that line, and says why.

Chapter 12 tested the same story inside boards, in `card.test.ts`, with boards'
outbox module. This test covers it through the backoffice, so delete that one: in
`cooper/backend/contexts/boards/modules/card/card.test.ts`, remove the last test, `'a
reaction that keeps failing dies after its attempts, is listed, and runs once
retried'`, whole.

Retrying is only half of it. A job is dead because something is wrong: read its
`lastError`, fix that, and only then retry. Retrying first only kills it again.

### The metrics

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CardDTO } from '../../../boards/modules/card/card.schema'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('metric', () => {
  let t: TestBackoffice

  beforeEach(async () => {
    t = await openTestBackoffice()
  })

  afterEach(() => t.close())

  const today = () => new Date().toISOString().slice(0, 10)

  test('counts what auth and boards tell, once their workers ran', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')
    const acme = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    await t.board(ana, acme.id, 'Roadmap', ['One', 'Two', 'Three'])

    // Nothing yet: the numbers are a projection, a moment behind.
    expect((await t.as(sam, () => t.modules.metric.overview())).totals).toEqual({ cards: 0, workspaces: 0, signUps: 0 })

    await t.settled()

    const { cards } = (await t.boards.modules.card.countByWorkspace([acme.id]))[0]!
    expect(cards).toBeGreaterThanOrEqual(3)
    const overview = await t.as(sam, () => t.modules.metric.overview())
    expect(overview.totals).toEqual({ cards, workspaces: 1, signUps: 2 })
    expect(overview.cardsPerDay).toHaveLength(30)
    expect(overview.cardsPerDay.at(-1)).toEqual({ day: today(), count: cards })
    expect(overview.workspacesPerDay.at(-1)).toEqual({ day: today(), count: 1 })
    expect(overview.signUpsPerDay.slice(0, -1).every(day => day.count === 0)).toBe(true)
  })

  test('counts by the day of the context\'s clock, and shows the days up to its today', async () => {
    await t.close()
    let time = Date.parse('2027-03-15T12:00:00Z')
    t = await openTestBackoffice({ clock: { now: () => new Date(time) } })
    const sam = await t.staffMember('Sam')
    await t.settled()

    expect((await t.as(sam, () => t.modules.metric.overview())).signUpsPerDay.at(-1)).toEqual({ day: '2027-03-15', count: 1 })

    time += 2 * 24 * 60 * 60_000
    const { signUpsPerDay } = await t.as(sam, () => t.modules.metric.overview())
    expect(signUpsPerDay.slice(-3)).toEqual([{ day: '2027-03-15', count: 1 }, { day: '2027-03-16', count: 0 }, { day: '2027-03-17', count: 0 }])
  })

  test('counts a card once, however many times its worker runs', async () => {
    const card = { id: '0190a0a0-0000-7000-8000-000000000001', workspaceId: 'w', createdAt: new Date().toISOString() } as CardDTO
    await t.modules.metric.recordCard(card)
    await t.modules.metric.recordCard(card)

    const sam = await t.staffMember('Sam')
    expect((await t.as(sam, () => t.modules.metric.overview())).totals.cards).toBe(1)
  })
})
```

- The first test says the numbers are **a moment behind**: zero until the workers
  ran, then what auth and boards hold. A new workspace has a welcome board with cards,
  so the cards are compared with boards' own count.
- The second gives every context a clock ([chapter 19](./19-invitations-and-time)),
  moves it two days, and sees the days move with it, the empty ones included.
- The third calls `recordCard` twice with the same card, as a worker run twice would:
  it counts once.

### The API

`backoffice.context.test.ts` asks the two new routes too: 401 without a session, 200
to the staff, 403 after a revoke. Change the two lists of paths:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.test.ts
// …
    for (const path of ['/api/session', '/api/workspaces', '/api/users', '/api/staff', '/api/metrics', '/api/jobs/boards']) {
// …
    for (const path of ['/api/session', '/api/workspaces', '/api/users/' + sam.id, '/api/staff', '/api/metrics']) {
// …
```

## The backoffice's frontend

The API is whole, so the backoffice gets its frontend. Like boards' in [chapter
23](./23-frontends), it is copied from the repository. Copy the app and its API
clients from this chapter's tag:

```sh
git checkout tutorial/26 -- cooper/frontend/backoffice cooper/libs/api/backoffice-job cooper/libs/api/backoffice-metric cooper/libs/api/backoffice-staff cooper/libs/api/backoffice-user cooper/libs/api/backoffice-workspace
```

```
cooper/
  frontend/
    backoffice/            the staff's console: index.html, main.tsx, app.routes.tsx, vite.config.ts
      guards/              the session guard: signing in happens at auth
      modules/             overview, workspaces, users, staff, jobs: one zone each, lazy
      pages/               the shell, sign-in, not found, a route's error
      services/session/    who is signed in, from GET /api/session
  libs/
    api/
      backoffice-job/      a client per module of the backoffice: BackofficeJobApi…
      backoffice-metric/
      backoffice-staff/
      backoffice-user/
      backoffice-workspace/
```

It is built as chapter 23's apps are: `@cooper/ui` for every component, `@cooper/core`
for stores, a `Requester` per module in `@cooper/api`. Each client imports its module's
schema from the backend, so the frontend and the API share one contract. For
instance, the jobs' client:

```ts
// cooper/libs/api/backoffice-job/backoffice-job.api.ts
import type { ContextJobDTO, JobContext } from '../../../backend/contexts/backoffice/modules/job/job.schema'
import type { Page } from 'newt/contract'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backoffice's `job` module: the jobs that died in each context. */
export class BackofficeJobApi extends Requester {
  protected readonly path = '/jobs'

  /** A context's dead jobs, the newest first. */
  dead(context: JobContext, page?: PageRequest) {
    return this.get<Page<ContextJobDTO>>(`/${context}`, page)
  }

  /** Puts a dead job back to run: a 409 `outbox.job_not_dead` if it is not dead any more. */
  retry(context: JobContext, jobId: string) {
    return this.post<void>(`/${context}/${jobId}/retry`)
  }
}
```

The overview shows `GET /api/metrics` and the boards created last; the jobs page has a
tab per context in `JOB_CONTEXTS`, each a list with a retry button.

The rest is typed. The shared Vite config learns the third app's name and its
backend's port, in `vite-app.ts`:

```ts
// cooper/frontend/vite-app.ts
// …
  name: 'auth' | 'boards' | 'backoffice'
// …
const BACKEND_PORTS = { auth: 3001, boards: 3002, backoffice: 3003 } as const
// …
/**
 * What the three apps share: React, Tailwind, the aliases of cooper's libraries,
 * a fixed dev port that proxies to the app's context, and the build in
 * `dist/cooper/<name>`, which that context serves in production.
 */
// …
```

The app's own `vite.config.ts`, which you copied, gives it port 5173 and proxies
`/api`: the backoffice serves nothing outside its API.

`bun run cooper` starts the third Vite server and checks its ports. In
`cooper/scripts/dev.ts`:

```ts
// cooper/scripts/dev.ts
// …
const frontend = (name: 'auth' | 'boards' | 'backoffice') => {
// …
const SERVICES = [
  frontend('auth'),
  frontend('boards'),
  frontend('backoffice'),
// …
  ...(['auth', 'boards', 'backoffice'] as const).map(name => ({ name: `${name} API`, port: config[name].port })),
// …
  const names = ['auth', 'boards', 'backoffice'] as const
// …
```

`bun run cooper:build` builds it too. In the root `package.json`:

```json
"cooper:build": "vite build cooper/frontend/auth && vite build cooper/frontend/boards && vite build cooper/frontend/backoffice"
```

Once built, the backoffice context serves `dist/cooper/backoffice` for every address
its API does not take: `frontendFolder` has been in its config since chapter 25.

## A staff account in the seed

The staff do not sign up to the backoffice: auth refuses new accounts for it. Someone
must be given access first, and the seed does it, the way `staffMember` does in the
tests: an account, admitted with `access.admit`, which checks no actor. In
`cooper/scripts/seed.ts`, the opening comment names it:

```ts
// cooper/scripts/seed.ts
// bun run cooper:seed: cooper's demo data, written through the contexts' use cases as
// anyone would: a staff user with access to the backoffice, and Ana's workspace Acme,
// where Bob joined by accepting her invitation. Safe to run again: what is there stays.
// …
```

make it before Ana:

```ts
// cooper/scripts/seed.ts
// …
  const account = async (email: string, name: string) => (await user.findByEmail(email)) ?? user.signUp({ email, name, password: PASSWORD })

  const staff = await account('staff@cooper.dev', 'Cooper Staff')
  await access.admit({ userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' })

  const ana = await account('ana@cooper.dev', 'Ana García')
// …
```

and print its line with the others:

```ts
// cooper/scripts/seed.ts
// …
    '',
    `  staff@cooper.dev   the staff: the backoffice, ${config.backoffice.publicUrl}`,
    `  ana@cooper.dev     Acme's admin, ${config.boards.publicUrl}: its boards Welcome and Launch`,
// …
```

`account` finds the account if it is there, and `admit` given twice gives it once: run
again, the seed changes nothing. The seed opens every context, so its sign-ups,
workspace and cards are counted by the metric workers like anyone's.

## Check it

The gate:

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint && bun run cooper:build
```

The backoffice's tests and the adapter's:

```sh
bun test cooper/backend/contexts/backoffice cooper/backend/shared/analytics
```

```text
 24 pass
 0 fail
 92 expect() calls
Ran 24 tests across 8 files.
```

Seed, and start the server:

```sh
bun run cooper:seed
bun cooper/backend/index.ts
```

```text
…
cooper is seeded. Every account's password is
  cooper-demo

  staff@cooper.dev   the staff: the backoffice, http://localhost:5173
  ana@cooper.dev     Acme's admin, http://localhost:5172: its boards Welcome and Launch
  bob@cooper.dev     a member of Acme, who accepted Ana's invitation
…
```

The metrics want someone signed in, and the backoffice now serves its built frontend
for any other address:

```sh
curl -i localhost:3003/api/metrics
curl -s localhost:3003/ | grep -o '<title>.*</title>'
```

```text
HTTP/1.1 401 Unauthorized
…

{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
<title>Cooper Backoffice</title>
```

### Sign in with curl

The sign-in goes through auth's pages, which live behind the public URLs of the Vite
servers. To walk it with curl against the APIs alone, start the server with each
public URL set to its context's own port, so every redirect lands on an API. Stop it,
and start it again:

```sh
COOPER_AUTH_PUBLIC_URL=http://localhost:3001 COOPER_BOARDS_PUBLIC_URL=http://localhost:3002 COOPER_BACKOFFICE_PUBLIC_URL=http://localhost:3003 bun cooper/backend/index.ts
```

Then, with a cookie jar, as a browser would: start at the backoffice, follow it to
auth, sign in there as the staff, say yes, and follow auth back:

```sh
J=$(mktemp)
L1=$(curl -s -c $J -b $J -o /dev/null -w '%{redirect_url}' "localhost:3003/api/session/sign-in?returnTo=/")
L2=$(curl -s -c $J -b $J -o /dev/null -w '%{redirect_url}' "$L1")
ID=${L2##*/authorize/}
curl -s -c $J -b $J -X POST localhost:3001/api/session/sign-in -H 'content-type: application/json' -d '{"email":"staff@cooper.dev","password":"cooper-demo"}' > /dev/null
BACK=$(curl -s -c $J -b $J -X POST localhost:3001/api/authorizations/$ID/approve | sed 's/.*"redirectTo":"\([^"]*\)".*/\1/')
curl -s -c $J -b $J -o /dev/null -w '%{http_code} %{redirect_url}\n' "$BACK"
```

```text
302 http://localhost:3003/
```

The jar now holds the backoffice's session cookie. Ask the API:

```sh
curl -s -b $J localhost:3003/api/session
curl -s -b $J localhost:3003/api/workspaces
curl -s -b $J localhost:3003/api/metrics
curl -s -b $J localhost:3003/api/jobs/boards
curl -s -b $J localhost:3003/api/jobs/nowhere
```

```text
{"user":{"id":"01a1…","email":"staff@cooper.dev","name":"Cooper Staff",…}}
{"items":[{"id":"01a1…","name":"Acme","createdAt":"…","admin":{"id":"01a1…","name":"Ana García","email":"ana@cooper.dev"},"cards":7}],"hasMore":false,"total":1}
{"totals":{"cards":7,"workspaces":1,"signUps":3},"cardsPerDay":[{"day":"2026-09-27","count":0},…],…}
{"items":[],"hasMore":false,"total":0}
{"error":"Some of what was sent is not right: check the fields and try again","code":"validation","issues":[{"code":"invalid_value","values":["auth","boards","backoffice"],"path":[],"message":"Invalid option: expected one of \"auth\"|\"boards\"|\"backoffice\""}]}
```

The seed's three sign-ups, its one workspace and its seven cards were counted by the
metric workers while the seed ran. No job died, so boards' page is empty. The same
walk as `ana@cooper.dev` stops at the approval, with auth's 403
`oauthGrant.no_access`.

### In the browser

Stop the server, and start cooper with its frontends:

```sh
bun run cooper
```

Open `http://localhost:5173`, sign in at auth as `staff@cooper.dev` with the seed's
password, and you land on the overview: the totals, a chart per series, the boards
made last. Look up Acme under Workspaces, Ana under Users, grant someone under Staff,
and open Jobs: one tab per context, each empty until a job dies.

## What to remember

- **Each context keeps and runs its own jobs.** Whoever looks after them goes through
  that context's use cases (`outbox.dead`, `outbox.retry`, over the port's `list`,
  `get` and `retry`), never through its store. A dead job is retried once what killed
  it is fixed, and a job not dead is never run again.
- **Analytics are a projection**: `handler` workers follow events and `append` rows by
  the id of what they count, so a worker run twice counts once. They are a moment
  behind, and never in a context's transaction.
- **newt's port only appends; reading is the adapter's.** Declare the questions you
  ask in an interface of your own (`AnalyticsCounts`), and let the module take both.
- **An adapter passes the port's contract**: `describeAnalyticsContract` for
  analytics, with `MemoryAnalytics` as the plainest example and a stand-in for tests.
- **A job lives in the outbox of the save that told its event**: the metric jobs are
  auth's and boards', not the backoffice's, and so are their dead ones.

Next: [Postgres, MySQL and migrations in production](./27-postgres).
