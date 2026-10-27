# Archive, restore, delete

An application the monitor watches may stop being watched, and come back. Nothing it
knew of it is lost when it stops: it is **archived**, kept with everything of it, and
shown only when asked. It is **deleted** only once it is archived, and then for good,
with all the monitor knew of it.

That is the application's life, and the entity keeps it: each step is a method, each
one an event the next chapters listen to.

```
registered ──archive──▶ archived ──delete──▶ gone
     ▲                     │
     └──────restore────────┘
```

At the end you will have these files:

```
packages/newt-monitor/src/contexts/monitor/
  migrations/sqlite/
    00003_app_archived_up.sql     archived_at
    00003_app_archived_down.sql
  modules/app/
    app.schema.ts                 changed: archivedAt, the list's filter, what app.deleted tells
    app.ts                        changed: archive, restore, delete
    app.module.ts                 changed: the use cases, and the list filtered
    app.routes.ts                 changed: POST …/archive, …/restore, DELETE
    events/app-archived.ts
    events/app-restored.ts
    events/app-deleted.ts
    errors/app-not-archived.ts
    app.test.ts                   changed
```

## A column, by a migration

A change of shape is a new migration, never an edit of one applied
([chapter 27 of the guide](../guide/27-postgres)):

```sql
-- packages/newt-monitor/src/contexts/monitor/migrations/sqlite/00003_app_archived_up.sql
-- An application archived: the monitor stops watching it, and keeps all it knows of it
-- until it is deleted, which only an archived one can be.
ALTER TABLE app ADD COLUMN archived_at TEXT;
```

## Why not `softDelete`

newt's repositories can delete softly: `deletedAt` stamped, and every find leaves the
row out. That is for something gone that others still point at. An archived
application is not gone: it is listed when asked, shown, restored. So it is a field of
the entity, `archivedAt`, and the list filters on it.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.schema.ts
  /** When it was archived: it is not watched, and all it was is kept. Null while it is. */
  archivedAt: z.iso.datetime().nullable().default(null),
```

## The steps, in the entity

Archiving one archived is archiving it once, and tells nothing: an event says
something happened. Deleting asks for it archived first.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.ts
  /** No longer watched, all it was kept. Archiving one archived is archiving it once. */
  archive(): void {
    if (this.isArchived) return
    this.change({ archivedAt: now().toISOString() })
    this.trackEvent(new App_Archived(this.toDTO()))
  }

  /** Watched again. */
  restore(): void {
    if (!this.isArchived) return
    this.change({ archivedAt: null })
    this.trackEvent(new App_Restored(this.toDTO()))
  }

  /** Gone for good, with all the monitor knows of it: only once it is archived. */
  delete(): void {
    if (!this.isArchived) throw new AppNotArchived(this.name)
    this.markAsDeleted()
    this.trackEvent(new App_Deleted({ id: this.id, name: this.name }))
  }
```

`app.deleted` tells only which application it was: there is nothing else of it. The
modules that keep something of an application will hear it, and delete theirs
([chapter 11](./11-deleting-for-real)).

## The list, filtered

Those watched, unless the request says `?status=archived`, or `all`. The filter is
what a client sends, so it is parsed as anything a client sends is:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async list(filter: unknown, page: PageRequest): Promise<Page<AppDTO>> {
    const { status } = AppListSchema.parse(filter)
    const criteria = status === 'active' ? { archivedAt: null } : status === 'archived' ? { archivedAt: { ne: null } } : {}
    return mapPage(await this.repo.page(criteria, page, { newestFirst: true }), app => app.toDTO())
  }
```

## The routes

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.routes.ts
  base.http.post('/apps/:id/archive', async request => Response.json(await apps.archive(request.params.id)))

  base.http.post('/apps/:id/restore', async request => Response.json(await apps.restore(request.params.id)))

  base.http.delete('/apps/:id', async request => {
    await apps.delete(request.params.id)
    return new Response(null, { status: 204 })
  })
```

Deleting one that is not archived is a 409, `app.not_archived`.

## Tests

The whole life, and what it tells: a step it was already at tells nothing.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.test.ts
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}/restore`, { method: 'POST' })
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}`, { method: 'DELETE' })

    expect(told).toEqual(['registered', 'archived', 'restored', 'archived', 'deleted'])
```

## Check it

```sh
bun test packages/newt-monitor
```

## What to remember

- Something that stops but is kept is a state of the entity, not a soft delete.
- Each step of a life is a method of the entity, and an event; a step it is already at
  is no change, and tells nothing.
- A step that cannot be undone asks for the one before it: archive, then delete.

Next: [talking to an application](./06-talking-to-an-application).
