# D. Writing a store

newt keeps a context's data behind a port, `Store`, from `newt/port-store`. cooper
uses three adapters of it: `FileStore` in its first chapters, `SqliteStore` from
[chapter 5](./05-sqlite), and `PostgresStore` (or `MySqlStore`) in production
([chapter 27](./27-postgres)). No module, repository or use case changed when the store
did: they only know the port.

This appendix writes a fourth adapter, a store in memory, and proves it with the suite
every adapter of newt passes, `describeStoreContract`. The code here is not part of
cooper; it lives only in this appendix. The whole store is below, about 270 lines, and
it passes all 87 tests of the suite.

When would you write one? For a database newt has no adapter for, or for a store with
other trade-offs (one for tests, one over a key-value service). For another SQL
database, start from `newt/sql` instead, as the Postgres and MySQL adapters do (see
[the end](#a-sql-database)).

## What a store promises

`Store` is small:

```ts
export interface Store {
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
  guard(keys: string[]): Promise<void>
  afterCommit(fn: () => void): void
  afterRollback(fn: () => void): void
  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): Table<Row>
  readonly outbox: Outbox
  readonly migrations: Migrations
  close(): Promise<void>
}
```

What it promises is not. Every adapter keeps these, and the suite checks each one:

- **A transaction is all or nothing**, its outbox jobs included. A call inside one
  joins it: there is only ever the outermost.
- **The current transaction follows the code**, across `await`s, without being handed
  it.
- **Transactions that guard the same key never interleave**, so a rule over several
  rows ([chapter 6](./06-rules-over-rows)) holds on every store.
- **Reads outside a transaction see only what is committed.**
- **A stored row keeps its version**: a write that finds another throws
  `ConcurrencyConflict`; a new row whose id or unique value is taken throws
  `DuplicateValue` ([chapter 8](./08-two-people-one-card)).

A table, `Table<Row>`, is what `TableRepository` works on: `find` and `count` by
`Criteria`, `insert`, `update` and `delete` by version, `patch` whatever the version,
and `deleteMany` by criteria. The outbox, `Outbox` from `newt/port-outbox`, is where
`'handler'` jobs are kept, in the same storage as the data, so a job is written in the
transaction of the change that publishes it ([chapter 11](./11-reacting)).

## Set up

The store is a project of its own, which depends on `newt` and `zod`: one source file,
`memory-store.ts`, and one test, `memory-store.test.ts`. The sections below are
`memory-store.ts` from top to bottom.

## The store: TransactionScope

The hardest promises are about transactions, and newt gives the machinery for them:
`TransactionScope`, from `newt/port-store`. It runs transactions one at a time, in the
order they ask; keeps the current one in an `AsyncLocalStorage`, so a call inside one
joins it; closes it once it starts committing, so a late call fails instead of running
outside it; runs `afterCommit` and `afterRollback` callbacks; and fails a call that
waits too long, saying why; and keeps which modules each transaction saved, so the
write rule refuses a second module's save in it (one module per transaction, in a
worker too). An adapter that does not build on it is not checked for that. Its
`State` is whatever the adapter keeps for each transaction.

An adapter hands `run` its steps: `begin`, `commit`, `rollback` and an optional `end`.
Because the scope runs one transaction at a time, `guard` needs nothing more than being
in one; a store whose transactions run side by side (Postgres) passes `serial: false`
and takes a lock per key itself.

Here, every table is a `Map` of rows by id. A transaction writes to its own copy of
each table it touches (its `State`), and its commit puts those copies in place of the
committed ones. A read outside a transaction sees the committed tables, so it never
sees what is not committed; one inside sees the transaction's copies, so it reads what
it wrote.

```ts
import { compare, ConcurrencyConflict, DuplicateValue, matches, type Criteria } from 'newt/core'
import { isSameClaim, type Job, type JobClosing, type JobQuery, type JobQueueRegistration, type Outbox } from 'newt/port-outbox'
import { noteRead, TransactionScope, type FindOptions, type Migrations, type MigrationStatus, type NewRow, type Store, type StoredRow, type Table, type TableOptions } from 'newt/port-store'

type Row = Record<string, unknown>
/** A table's rows, by id. */
type Rows = Map<string, Row>
/** What a transaction writes: its own copy of each table it touched. */
type Staged = Map<string, Rows>

/**
 * A store in memory: every table a map of rows, gone when the process ends. For tests
 * and examples, not for data you keep. Its transactions take turns (TransactionScope),
 * so guarding a key needs nothing more than being in one; each one writes to copies
 * of the tables it touches, which replace the committed ones when it commits.
 */
export class MemoryStore implements Store {

  readonly outbox: Outbox = new MemoryOutbox(this)
  readonly migrations: Migrations = new NoMigrations()

  private committed = new Map<string, Rows>()
  private readonly scope = new TransactionScope<Staged>()

  static async open(): Promise<MemoryStore> {
    return new MemoryStore()
  }

  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const staged: Staged = new Map()
    return this.scope.run(fn, staged, {
      begin: () => {},
      commit: () => { for (const [name, rows] of staged) this.committed.set(name, rows) },
      rollback: () => {},
    })
  }

  guard(keys: string[]): Promise<void> {
    return this.scope.guard(keys)
  }

  afterCommit(fn: () => void): void {
    this.scope.afterCommit(fn)
  }

  afterRollback(fn: () => void): void {
    this.scope.afterRollback(fn)
  }

  table<R extends StoredRow>(name: string, options?: TableOptions<R>): Table<R> {
    return new MemoryTable<R>(this, name, options)
  }

  async close(): Promise<void> {
    await this.scope.drain()
  }

  /** A table's rows as this code sees them: the transaction's copy, else the committed ones. */
  read(name: string): Rows {
    this.scope.assertNotEnded()
    return this.scope.state?.get(name) ?? this.committed.get(name) ?? new Map()
  }

  /** A table's rows to write, in the transaction in progress: its own copy, made the first time. */
  write(name: string): Rows {
    this.scope.assertNotEnded()
    const staged = this.scope.state
    if (!staged) throw new Error('A write runs inside store.transaction')
    let rows = staged.get(name)
    if (!rows) staged.set(name, rows = new Map(this.committed.get(name)))
    return rows
  }
}
```

`read` and `write` are the store's own API, for its table and its outbox. Both start
with `assertNotEnded`: a call that belongs to a transaction that has ended fails with
newt's message ("This call belongs to a transaction that has ended…").

## Tables: criteria, versions, unique values

`find` and `count` take `Criteria`, the same words every store answers alike
([chapter 15](./15-kysely)). A store that checks rows one by one answers them with
`matches(row, criteria)`, from `newt/core`: it answers what SQL would, so a comparison
with `null` holds for nothing, and `ieq` ignores the case of A to Z only. Sorting uses
`compare`, which orders text by code point and puts `null` first going up.

Each table also calls `noteRead(name)` as it finds and counts. That is how the guard
rule works on every store: a save that guards nothing and reads rows is refused
([chapter 6](./06-rules-over-rows)).

The writes keep versions: `insert` gives version 1, `update` and `delete` need the
version the caller read, `patch` leaves it as it is. `TableOptions.unique` lists the
fields no two rows share, a row deleted softly aside; a store whose structure says it
already (a unique index) ignores it.

```ts
class MemoryTable<R extends StoredRow> implements Table<R> {

  constructor(private readonly store: MemoryStore, private readonly name: string, private readonly options: TableOptions<R> = {}) {}

  async find(criteria?: Criteria<R>, options: FindOptions<R> = {}): Promise<R[]> {
    if (options.limit !== undefined && !(Number.isInteger(options.limit) && options.limit >= 0)) throw new Error(`A limit is a whole number, 0 or more: not ${options.limit}`)
    const order = options.orderBy ?? [{ field: 'id' }]
    const rows = this.rows(criteria).sort((a, b) => {
      for (const { field, direction } of order) {
        const by = compare(a[field], b[field])
        if (by !== 0) return direction === 'desc' ? -by : by
      }
      return 0
    })
    noteRead(this.name)
    return options.limit === undefined ? rows : rows.slice(0, options.limit)
  }

  async count(criteria?: Criteria<R>): Promise<number> {
    noteRead(this.name)
    return this.rows(criteria).length
  }

  insert(row: NewRow<R>): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      if (rows.has(row.id)) throw new DuplicateValue(['id'])
      this.put(rows, { ...defined(row), version: 1 })
    })
  }

  update(id: string, version: number, changes: Partial<NewRow<R>>): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      const current = rows.get(id)
      if (current?.version !== version) throw new ConcurrencyConflict()
      this.put(rows, { ...current, ...defined(changes), id, version: version + 1 })
    })
  }

  patch(id: string, changes: Partial<NewRow<R>>): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      const current = rows.get(id)
      if (!current) return
      const { id: _, version: __, ...fields } = defined(changes)
      this.put(rows, { ...current, ...fields })
    })
  }

  delete(id: string, version: number): Promise<void> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      if (rows.get(id)?.version !== version) throw new ConcurrencyConflict()
      rows.delete(id)
    })
  }

  deleteMany(criteria: Criteria<R>): Promise<number> {
    return this.writing(() => {
      const rows = this.store.write(this.name)
      const gone = [...rows.values()].filter(row => matches(row, criteria as Criteria<Row>))
      for (const row of gone) rows.delete(row.id as string)
      return gone.length
    })
  }

  /**
   * Runs a write in the transaction in progress, or in one of its own, a turn of the
   * event loop later, as a store that waits for its disk would: a write still in flight
   * when its transaction ends then fails, instead of landing in it.
   */
  private writing<T>(fn: () => T): Promise<T> {
    return this.store.transaction(async () => {
      await Bun.sleep(0)
      return fn()
    })
  }

  /** Copies of the rows that meet the criteria: what a caller changes is not what is kept. */
  private rows(criteria?: Criteria<R>): R[] {
    return [...this.store.read(this.name).values()].filter(row => matches(row, criteria as Criteria<Row>)).map(row => structuredClone(row) as R)
  }

  /** Keeps a copy of the row, once no other row has its value in a unique set of fields. */
  private put(rows: Rows, row: Row): void {
    if (row.deletedAt === null || row.deletedAt === undefined) {
      for (const fields of this.options.unique ?? []) {
        if (fields.some(field => row[field] === null || row[field] === undefined)) continue
        const taken = [...rows.values()].some(other => other.id !== row.id && (other.deletedAt ?? null) === null && fields.every(field => other[field] === row[field]))
        if (taken) throw new DuplicateValue(fields)
      }
    }
    rows.set(row.id as string, structuredClone(row))
  }
}
```

`writing` waits a turn of the event loop before it writes. A store that talks to a disk
or a server does that anyway; one in memory must do it on purpose, or a write still in
flight when its transaction rolls back would land in the dropped copy instead of
failing as the suite expects. Every value is copied in and out (`structuredClone`), so
what a caller changes is not what is kept.

## Migrations

A store remembers the changes to its structure (`Migrations`: `up`, `down`,
`status`, which tells a `MigrationStatus`: what is `applied`, what is `pending`, and
what was `changed` after it was applied). An in-memory store has no structure to
change, so its migrations are none:

```ts
/** An in-memory store has no structure to change: nothing to migrate. */
class NoMigrations implements Migrations {
  async up(): Promise<string[]> { return [] }
  async down(): Promise<string | null> { return null }
  async status(): Promise<MigrationStatus> { return { applied: [], pending: [], changed: [] } }
}
```

A real store applies its scripts here, in order, all or none, and keeps for each one its
name and a checksum. newt gives both: `migrationName(3, 'product-code')` is
`00003_product-code`, and `migrationChecksum(script)` is the SHA-256 the store compares
when it opens, refusing a migration changed after it was applied
([chapter 5](./05-sqlite)).

## The outbox

The outbox is the part a worker (`JobQueue`) talks to. It keeps `Job`s in the same
storage as the data: here, two more tables of the store, `_jobs` and `_job_queues`, so
`add` inside a save writes its jobs in the save's transaction and a rollback takes them
with it.

- `claim` takes up to `limit` jobs of some queues, pending and due, or running with
  their lease run out, as of `now` (the worker's clock); each claim counts one more
  attempt and is locked by `worker`, a name no claim used before.
- `renew` and `close` change a job only while it is still the claim it was:
  `isSameClaim`, from `newt/port-outbox`, compares status, `lockedBy` and `attempts`,
  so a worker whose lease ran out cannot close what another took over.
- `retry` puts a dead job back as new; `purge` forgets jobs done before a time;
  `list`, `get`, `waiting` and `queues` are for whoever looks after the jobs
  ([chapter 12](./12-failures), [chapter 26](./26-dead-jobs-and-analytics)).

```ts
/** The outbox, as two more tables of the store: its jobs are written in the transaction of the change. */
class MemoryOutbox implements Outbox {

  constructor(private readonly store: MemoryStore) {}

  add(jobs: Job[]): Promise<void> {
    return this.store.transaction(() => {
      for (const job of jobs) this.store.write('_jobs').set(job.id, structuredClone(job))
    })
  }

  claim(queues: string[], limit: number, worker: string, leaseUntil: string, now = new Date().toISOString()): Promise<Job[]> {
    return this.store.transaction(() => {
      const claimed = this.jobs()
        .filter(job => queues.includes(job.queue))
        .filter(job => (job.status === 'pending' && job.runAfter <= now) || (job.status === 'running' && job.lockedUntil !== null && job.lockedUntil < now))
        .sort((a, b) => compare(a.runAfter, b.runAfter))
        .slice(0, limit)
        .map(job => ({ ...job, status: 'running' as const, lockedBy: worker, lockedUntil: leaseUntil, attempts: job.attempts + 1, updatedAt: now }))
      for (const job of claimed) this.store.write('_jobs').set(job.id, job)
      return claimed.map(job => structuredClone(job))
    })
  }

  renew(claimed: Job, leaseUntil: string): Promise<void> {
    return this.onClaim(claimed, job => ({ ...job, lockedUntil: leaseUntil }))
  }

  close(claimed: Job, closing: JobClosing): Promise<void> {
    return this.onClaim(claimed, job => ({ ...job, status: closing.status, lastError: closing.lastError, runAfter: closing.runAfter ?? job.runAfter, lockedBy: null, lockedUntil: null }))
  }

  retry(id: string): Promise<boolean> {
    const now = new Date().toISOString()
    return this.store.transaction(() => {
      const stored = this.store.read('_jobs').get(id) as Job | undefined
      if (stored?.status !== 'dead') return false
      this.store.write('_jobs').set(id, { ...stored, status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, updatedAt: now })
      return true
    })
  }

  seen(queues: JobQueueRegistration[]): Promise<void> {
    const now = new Date().toISOString()
    return this.store.transaction(() => {
      for (const queue of queues) this.store.write('_job_queues').set(queue.name, { ...queue, lastSeenAt: now })
    })
  }

  purge(before: string): Promise<void> {
    return this.store.transaction(() => {
      for (const job of this.jobs()) if (job.status === 'done' && job.updatedAt < before) this.store.write('_jobs').delete(job.id)
    })
  }

  async list({ status, after, limit }: JobQuery = {}): Promise<Job[]> {
    const all = this.jobs().sort((a, b) => compare(a.createdAt, b.createdAt) || compare(a.id, b.id))
    const from = after === undefined ? 0 : (all.findIndex(job => job.id === after) + 1 || all.length)
    const found = all.slice(from).filter(job => status === undefined || job.status === status)
    return limit === undefined ? found : found.slice(0, limit)
  }

  async get(id: string): Promise<Job | undefined> {
    const job = this.store.read('_jobs').get(id)
    return job && structuredClone(job) as Job
  }

  async waiting(): Promise<{ queue: string, jobs: number }[]> {
    const counts = new Map<string, number>()
    for (const job of this.jobs()) if (job.status === 'pending' || job.status === 'running') counts.set(job.queue, (counts.get(job.queue) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => compare(a, b)).map(([queue, jobs]) => ({ queue, jobs }))
  }

  async queues(): Promise<(JobQueueRegistration & { lastSeenAt: string })[]> {
    return [...this.store.read('_job_queues').values()].map(each => structuredClone(each) as JobQueueRegistration & { lastSeenAt: string }).sort((a, b) => compare(a.name, b.name))
  }

  private jobs(): Job[] {
    return [...this.store.read('_jobs').values()].map(job => structuredClone(job) as Job)
  }

  /** A write on a claimed job, only while it is still the claim it was (isSameClaim). */
  private onClaim(claimed: Job, change: (job: Job) => Job): Promise<void> {
    return this.store.transaction(() => {
      const stored = this.store.read('_jobs').get(claimed.id) as Job | undefined
      if (stored && isSameClaim(stored, claimed)) this.store.write('_jobs').set(stored.id, { ...change(stored), updatedAt: new Date().toISOString() })
    })
  }
}

function defined(values: object): Row {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}
```

## Proving it: describeStoreContract

`newt/port-store/contract` has the suite. It takes a name and a fixture, a
`StoreFixture`: an `open` that gives a fresh, empty store each time, which the suite
closes. This is the whole of `memory-store.test.ts`:

```ts
import { describeStoreContract } from 'newt/port-store/contract'
import { MemoryStore } from './memory-store'

describeStoreContract('MemoryStore', { open: () => MemoryStore.open() })
```

The suite works on one table, `thing`, of `ThingRow`s: an id, a workspace, a unique
`name`, a boolean, a number, a nullable note, a JSON list of tags, the dates and a
version. It asks for it as `store.table<ThingRow>('thing', { types: { archived: 'boolean',
tags: 'json' }, unique: [['name']] })`. A store whose structure is declared ahead
creates that table in its fixture: every field a column in snake case, `name` unique
among the rows whose `deleted_at` is null, text sorting by code point (`COLLATE "C"` on
Postgres, `utf8mb4_0900_bin` on MySQL). newt's own SQLite test does it with a migration:

```sql
CREATE TABLE thing (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, archived INTEGER NOT NULL, rank REAL NOT NULL,
  note TEXT, tags TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL
);
CREATE UNIQUE INDEX thing_name ON thing (name) WHERE deleted_at IS NULL
```

The memory store needs none: a table exists once something is written to it.

```sh
bun test
```

```text
 87 pass
 0 fail
 210 expect() calls
Ran 87 tests across 1 file.
```

The suite checks, in groups: a transaction (commits, rolls back, nests, reads its own
writes, fails late calls), isolation and guards, `afterCommit` and `afterRollback`, a
table (versions, `DuplicateValue`, soft deletes, every operator, `null`, nested `and`
and `or`, JSON fields, sorting by code point), a `TableRepository` on the store (pages,
saves, the guard rule, events published on commit), a scoped repository, closing, the
outbox (claims, leases, retries, purges, lists), the job queue running on it, and
schedules ticking once across processes. When a test fails, its name says which
promise broke: two of them failed on this store's first draft, a `find` that accepted a
`limit` of `NaN` and writes that finished before their transaction rolled back, and the
two fixes are in the code above.

## Using it

A context takes it as it takes any store: `new Base({ name: 'boards', store })`. It is
one process's memory, gone when the process ends, so it is for tests and examples, not
for data you keep.

## A SQL database

For a SQL database, translate criteria instead of checking rows one by one.
`criteriaTree(criteria)`, from `newt/core`, turns `Criteria` into a tree of
`CriteriaNode`s: `all` (and), `any` (or), and `field` with its condition, a field left
`undefined` left out, a bare value turned into `eq`:

```ts
criteriaTree({ workspaceId: 'w1', or: [{ rank: { gte: 3 } }, { note: null }] })
```

```json
{
  "kind": "all",
  "of": [
    { "kind": "field", "field": "workspaceId", "condition": { "eq": "w1" } },
    {
      "kind": "any",
      "of": [
        { "kind": "field", "field": "rank", "condition": { "gte": 3 } },
        { "kind": "field", "field": "note", "condition": { "eq": null } }
      ]
    }
  ]
}
```

A store walks that tree into its own query, answering as `matches` does: `eq: null` is
`IS NULL`, `ne` holds for `null` too (`IS DISTINCT FROM`), an `in` with `null` in it
asks for `IS NULL` beside it, an empty `all` holds for every row and an empty `any` for
none.

You do not have to write that for a SQL database. `newt/sql` has the code the Postgres
and MySQL adapters share: `SqlStore` (transactions on a connection pool, advisory locks
for guards), `SqlTable` (criteria to `WHERE`, versions, JSON and boolean columns),
`SqlOutbox`, `SqlMigrationRunner` (SQL files, checksums) and `splitStatements`. What
tells one database from another is a `SqlDialect`: how a parameter and a name are
written, how `ieq` and "differs from" are said, how a collision reads in its errors. A
new SQL adapter is mostly a dialect, and the same `describeStoreContract` proves it.
