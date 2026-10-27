# Deleting for real

Deleting an archived application removes its row ([chapter 5](./05-archive-restore-delete)).
But the monitor knows more of it, in other modules: whether it answered, every version
of its structure, its catalog. This chapter makes deleting take all of it: each module
hears `app.deleted` and forgets what it has of the application, from a worker. When the
jobs are done, nothing of it is left. Archived, everything of it stays.

At the end you will have these files:

```
packages/newt-monitor/src/contexts/monitor/
  deleting.test.ts                     every table, after deleting
  modules/app/app.module.ts            changed: find, for a worker
  modules/connection/
    connection.repository.ts           changed: purgeApp
    connection.module.ts               changed: forget
    connection.workers.ts              app.deleted: forget
  modules/structure/
    structure.schema.ts                changed: `gone`
    structure.repository.ts            changed: purgeApp
    structure.module.ts                changed: forget; a refresh of one gone
    structure.workers.ts               changed: app.deleted: forget
  modules/catalog/
    catalog.repository.ts              changed: purgeApp
    catalog.module.ts                  changed: forget; recording one gone
    catalog.workers.ts                 changed: app.deleted: forget
```

## Each module forgets its own

No module deletes another's rows: each one hears the event, and deletes its own
([chapter 14 of the guide](../guide/14-sagas) does it for a workspace). The repository
removes them for good with `purge`, which only a repository may call:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.repository.ts
  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.module.ts
  /** Forgets everything of an application deleted: forgetting it twice is forgetting it once. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
  }
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.workers.ts
/** An application deleted: whether it answered goes with it. */
export function registerConnectionWorkers(connection: Connection_Module, deps: Connection_Deps): void {
  deps.app.events.deleted.subscribe(app => connection.forget(app.id), {
    strategy: 'handler',
    queue: 'connection.forget.on.app.deleted',
  })
}
```

Each a `handler`: written with the deletion, in its transaction, so the application is
never deleted without its jobs to forget it. A job that runs twice purges nothing the
second time.

## A job told late

The jobs of one module do not wait for another's. A `catalog.record` written just
before the deletion may run after it; a refresh asked on registering, after an archive
and a deletion. Each would fail on an application that is not there, five times, and
die: a dead job for nothing. newt's rule is that a job finds nothing to do instead
([golden rule 8](../guide/a-golden-rules)).

So the app module answers whether an application is there, without a 404, for a
worker:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  /** One, or null if there is none: for a worker, whose application may be deleted since it was told. */
  @UseCase()
  async find(id: string): Promise<AppDTO | null> {
    return (await this.repo.first({ id }))?.toDTO() ?? null
  }
```

and the jobs that may come late ask it first:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.module.ts
  @UseCase()
  async record(appId: string): Promise<void> {
    // Told late, its application may be deleted since: there is nothing to bring.
    if (!await this.deps.app.find(appId)) return
```

A refresh of an application deleted says so, `gone`, as it says `archived` for one
archived.

## Tests

Every table, counted for an application, before and after:

```ts
// packages/newt-monitor/src/contexts/monitor/deleting.test.ts
    await as(`/api/apps/${shop}/archive`, { method: 'POST' })
    await as(`/api/apps/${shop}`, { method: 'DELETE' })
    await settled()

    expect(await rowsOf(shop)).toEqual({ app: 0, connection: 0, structure: 0, catalog: 0 })
    expect(await rowsOf(other)).toEqual({ app: 1, connection: 1, structure: 2, catalog: 7 })
```

And every job run again, or late, after: nothing changes, and no job is dead.

```ts
// packages/newt-monitor/src/contexts/monitor/deleting.test.ts
    expect(await rowsOf(shop)).toEqual({ app: 0, connection: 0, structure: 0, catalog: 0 })
    expect(await monitor.monitor.base.store.outbox.list({ status: 'dead' })).toEqual([])
```

## Check it

```sh
bun test packages/newt-monitor
```

## What to remember

- Deleting across modules is a saga: one event, and each module deletes its own, from
  a worker.
- `purge` removes rows for good, from the repository only.
- A job may come late: it asks whether there is still something to do, and does
  nothing, rather than fail.

Next: against cooper.
