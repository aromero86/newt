# The catalog

A version is the whole structure at one time. To ask *when did `card.archive`
appear*, or *which use cases are gone*, the monitor keeps every part on its own: the
**catalog**. Each context, module, use case and event any version had, with when it
first appeared, when it was last there, and when it went. Nothing goes from it: a part
that is gone is archived, and one that comes back is there again, its first appearance
kept.

At the end you will have these files:

```
packages/newt-monitor/src/contexts/monitor/
  initialize-modules.ts             changed: the catalog module
  migrations/sqlite/
    00006_catalog_item_up.sql
    00006_catalog_item_down.sql
  modules/catalog/
    catalog.schema.ts               an item, its kinds, the list's filter
    catalog.ts                      the entity: appear, seen, archive
    services/items-of.ts            the items a description has
    catalog.repository.ts
    catalog.deps.ts                 the app and structure modules
    catalog.module.ts               record, list, get
    catalog.routes.ts
    catalog.workers.ts              a new version: the catalog brought to it
    errors/catalog-item-not-found.ts
    catalog.test.ts
```

## An item

What it is, by its kind and its id (newt-graph's: `boards/card.create`), where it is,
what the description said of it, and its three times:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.schema.ts
  /** When the first version that had it was taken. */
  firstSeenAt: z.iso.datetime(),
  /** When the last version that had it was taken: for one still there, the last version's. */
  lastSeenAt: z.iso.datetime(),
  /** When the first version without it was taken; null while it is there. */
  archivedAt: z.iso.datetime().nullable().default(null),
```

The times are the versions' (`takenAt`), not when the catalog happened to run: what it
tells is the application's history, not the monitor's.

```sql
-- packages/newt-monitor/src/contexts/monitor/migrations/sqlite/00006_catalog_item_up.sql
-- One item of each kind and id per application.
CREATE UNIQUE INDEX catalog_item_key ON catalog_item (app_id, kind, item_id);
```

## Its life, in the entity

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.ts
  /** There, in the version taken `at`, as it describes it: back, if it had gone. */
  seen(item: DescribedItem, at: string): void {
    const details = JSON.stringify(item.details) === JSON.stringify(this.data.details) ? {} : { details: item.details }
    const back = this.isArchived ? { archivedAt: null } : {}
    if (this.data.lastSeenAt === at && !Object.keys(details).length && !Object.keys(back).length) return
    this.change({ lastSeenAt: at, ...details, ...back })
  }

  /** Not in the version taken `at`: gone, and kept. */
  archive(at: string): void {
    if (this.isArchived) return
    this.change({ archivedAt: at })
  }
```

Seen again in the same version, with the same details, it changes nothing.

## The items of a description

A plain function, in the module's `services/` ([appendix B of the
guide](../guide/b-module-anatomy)): a description in, its items out.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/services/items-of.ts
/** Every context, module, use case and event a description has, each as the catalog keeps it. */
export function itemsOf(description: ApplicationDescription): DescribedItem[] {
```

## Recording a version

The worker hears `structure.changed`, and calls `record` with the application only.
`record` reads the **last** version, whatever told it to run: a job may run twice, or
after the next one, and it comes to the same each time. New items appear, known ones
are seen, missing ones are archived, and only those that changed are saved, together,
under a guard on the application.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.module.ts
  @UseCase()
  async record(appId: string): Promise<void> {
    const version = await this.deps.structure.latest(appId)
    const known = new Map((await this.repo.allOf(appId)).map(item => [item.key, item]))
    const changed: CatalogItem[] = []
    for (const described of itemsOf(version.description)) {
      const key = `${described.kind}:${described.itemId}`
      const item = known.get(key)
      known.delete(key)
      if (!item) changed.push(CatalogItem.appear(appId, described, version.takenAt))
      else {
        item.seen(described, version.takenAt)
        if (item.hasPendingChanges) changed.push(item)
      }
    }
    for (const gone of known.values()) {
      gone.archive(version.takenAt)
      if (gone.hasPendingChanges) changed.push(gone)
    }
    await this.repo.persistAll(appId, changed)
  }
```

Many entities of one module in one save is one transaction: they are all saved, or
none ([chapter 7 of the guide](../guide/07-cards-and-a-counter)).

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.workers.ts
export function registerCatalogWorkers(catalog: Catalog_Module, deps: Catalog_Deps): void {
  deps.structure.events.changed.subscribe(({ appId }) => catalog.record(appId), {
    strategy: 'handler',
    queue: 'catalog.record.on.structure.changed',
  })
}
```

## Listing them

By kind, context and module; those there now, unless the request asks for the archived
ones, or all:

```
GET /api/apps/:id/catalog?kind=useCase&context=boards&module=card&status=all
```

## Tests

A deployment is the test application changed, the clock an hour later, and the
structure read again. A part that goes, and comes back:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.test.ts
  test('brings back what comes back, from when it first appeared', async () => {
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))
    await deployed(() => app.remove('billing'))
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))

    expect((await items('?context=billing'))[0]).toMatchObject({ firstSeenAt: '2026-01-01T10:00:00.000Z', lastSeenAt: '2026-01-01T12:00:00.000Z', archivedAt: null })
  })
```

And `record` run twice on the same version: every row as it was.

## Check it

```sh
bun test packages/newt-monitor
```

```sh
curl -s -b cookies.txt 'localhost:4800/api/apps/<id>/catalog?kind=useCase&context=boards'
```

## What to remember

- Keep history as states with their times: appeared, seen, archived. Nothing is
  removed.
- A worker that reacts to "something changed" reads how things are now, not what the
  event said: twice, or late, it comes to the same.
- Many entities of one module change together in one save.

Next: [deleting for real](./11-deleting-for-real).
