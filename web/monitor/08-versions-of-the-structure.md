# Versions of the structure

The monitor can ask an application what it is made of. This chapter keeps the answer:
the `structure` module reads it, and keeps it as a **version** only when it is not the
same as the last one. An application deployed ten times with the same code has one
version; the deployment that added a use case has the next. The history says what each
application was, and when that changed.

At the end you will have these files:

```
packages/newt/
  core/description/application-description.ts   moved from runtime: the description's types
  contract/index.ts                             changed: those types, for a browser too
packages/newt-monitor/src/contexts/monitor/
  initialize-modules.ts                         changed: the structure module
  migrations/sqlite/
    00005_structure_version_up.sql
    00005_structure_version_down.sql
  modules/structure/
    structure.schema.ts            a version, a summary, what a refresh comes to
    structure.ts                   the entity, and the hash of a description
    structure.repository.ts        the last version, and one taken at a time
    structure.deps.ts              the app and connection modules
    structure.module.ts            refresh, latest, history, get
    structure.routes.ts
    events/structure-changed.ts
    errors/structure-not-read.ts
    errors/structure-version-not-found.ts
    structure.test.ts
```

## The description is a contract

A version keeps the description an application gives: `ApplicationDescription`. Its
schema needs the type, and newt's lint refused it: a `.schema.ts` is what a frontend
loads too, so it takes from newt only `newt/contract` (`newt/schema-imports`). The
lint was right, and so was the schema: what an application says it is made of is a
contract, between the application, the monitor and the monitor's pages to come.

So newt moved those types to its core (they are only types, they run anywhere), and
`newt/contract` exports them, as it exports `Page` or `ErrorBody`. `newt/runtime`
still does, beside `describeApplication`.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.schema.ts
/** What an application was made of at some time, as its endpoint described it (`describeApplication`). */
export const StructureVersionSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** SHA-256 of the description: the same one twice is the same structure. */
  hash: z.string().length(64),
  description: z.custom<ApplicationDescription>(value => typeof value === 'object' && value !== null),
  takenAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})
```

The description is kept whole, as JSON. Its hash tells two the same: an application
describes itself the same way each time its code is the same.

## A version, taken once

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.ts
  /** A new version of `appId`'s structure, after `previous`, if there was one. */
  static take(appId: string, description: ApplicationDescription, hash: string, previous: StructureVersion | undefined): StructureVersion {
    const version = new StructureVersion({ appId, hash, description, takenAt: now().toISOString() }, true)
    version.trackEvent(new Structure_Changed({ appId, versionId: version.id, previousVersionId: previous?.id ?? null }))
    return version
  }
```

A version never changes. `structure.changed` says which one is new, and which it came
after: the catalog of the next chapters listens to it.

## Refreshing

Read; if the application does not answer, keep the last version and say why; if the
hash is the last one's, nothing changed; otherwise, a new version.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
  // Asking the application records, in `connection`, whether it answered: a note of the
  // call, which every call makes, not a change of the connection this use case decides.
  @UseCase({ writesTo: ['connection'] })
  async refresh(appId: string): Promise<RefreshDTO> {
    const read = await this.deps.connection.fetchStructure(appId)
    const previous = await this.repo.latest(appId)
    if (!read.answered) return { appId, outcome: 'unreachable', version: previous?.summary() ?? null, failure: read.failure }

    const hash = hashOf(read.value)
    if (previous?.hash === hash) return { appId, outcome: 'unchanged', version: previous.summary() }
    const version = StructureVersion.take(appId, read.value, hash, previous)
    await this.repo.persistAfter(version, previous)
    return { appId, outcome: 'changed', version: version.summary() }
  }
```

`writesTo: ['connection']` is newt's write rule at work ([chapter 11 of the
guide](../guide/11-reacting)): a use case that saves in another module outside a
worker says so, with the reason above it. Here, recording whether the application
answered is part of asking it.

## Two refreshes at once

The hourly refresh and the button may run together. Both read the same last version,
both find the structure new: only one may take the next version. The repository saves
it under a guard on the application, and counts again after writing: if the version
before it is no longer the one it read, it is a conflict, and the use case runs again
([chapter 8 of the guide](../guide/08-two-people-one-card)). Running again, it finds
its structure taken, and answers `unchanged`.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.repository.ts
  async persistAfter(version: StructureVersion, previous: StructureVersion | undefined): Promise<void> {
    await this.save([version], each => this.write(each), {
      guard: [`structure:${version.appId}`],
      after: async () => {
        const [last, before] = await this.find({ appId: version.appId }, { orderBy: [{ field: 'id', direction: 'desc' }], limit: 2 })
        if (last?.id !== version.id || before?.id !== previous?.id) this.conflict()
      },
    })
  }
```

## Reading them

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.routes.ts
export function registerStructureRoutes(base: MonitorBase, structures: Structure_Module): void {
  base.http.get('/apps/:id/structure', async request => Response.json(await structures.latest(request.params.id)))

  base.http.get('/apps/:id/structure/versions', async request => Response.json(await structures.history(request.params.id, pageRequestFrom(request))))

  base.http.get('/apps/:id/structure/versions/:versionId', async request => Response.json(await structures.get(request.params.id, request.params.versionId)))
}
```

The history lists versions without their descriptions: a page of them stays small.

## Tests

A deployment, as `serveTestApp` makes one: a context added, then taken away. Back to
what it was is a version too: the history says it changed twice.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.test.ts
  test('keeps a new version each time it changes, back to one it was too', async () => {
    const first = await refresh()
    app.add('billing', { invoice: { useCases: ['open'] } })
    const second = await refresh()
    app.remove('billing')
    const third = await refresh()
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.test.ts
  test('takes one version however many refreshes run at once', async () => {
    const refreshed = await Promise.all(Array.from({ length: 5 }, refresh))

    expect(refreshed.filter(each => each.outcome === 'changed')).toHaveLength(1)
    expect(await versions()).toHaveLength(1)
  })
```

## Check it

```sh
bun test packages/newt-monitor
```

## What to remember

- Keep what changes, not every time it is read: a hash tells the same from the new.
- A version is taken once and never changes; an event tells which came after which.
- A write into another module outside a worker says so, `writesTo`, and why.
- What both sides of a wire share is a contract: `newt/contract`, for a browser too.

Next: [every hour, and a button](./09-every-hour-and-a-button).
