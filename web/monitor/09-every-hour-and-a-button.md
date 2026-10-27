# Every hour, and a button

The structure is read when something asks. This chapter decides who: a **schedule**,
every hour on the hour, for every application watched; a **button**, a route that
reads one now; and the moments there is something new to read, each a **worker**: an
application registered, restored, or moved to another address or key.

At the end you will have these files:

```
packages/newt-monitor/src/contexts/monitor/modules/
  app/app.module.ts                  changed: watchedIds
  structure/
    structure.schema.ts              changed: `archived`, and what refreshing all comes to
    structure.module.ts              changed: the schedule, refreshAll, an archived one not read
    structure.routes.ts              changed: POST …/structure/refresh
    structure.workers.ts             what reads it, and when
    structure.test.ts                changed: registering reads it the first time
    structure.workers.test.ts
```

## The schedule

A schedule is an event a context tells as a cron expression says, in UTC
([chapter 19 of the guide](../guide/19-invitations-and-time)). The structure module
defines it, as one of its events:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
    this.events = eventsOf(base.bus, { changed: Structure_Changed })
    this.hourly = base.schedules.define('structure.hourly', '0 * * * *')
```

Each tick is told once, however many processes run the monitor: the first to record it
tells it.

## Refreshing them all

The hourly tick refreshes every application watched, one after another. One that does
not answer is recorded so, and the others go on: `refresh` never throws for it.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
  @UseCase({ writesTo: ['connection'] })
  async refreshAll(): Promise<RefreshAllDTO> {
    const refreshed: RefreshDTO[] = []
    for (const appId of await this.deps.app.watchedIds()) refreshed.push(await this.refresh(appId))
    return { refreshed }
  }
```

`watchedIds` answers every one, not a page. newt's rule is that no list is returned
whole unless the domain bounds it ([golden rule 11](../guide/a-golden-rules)); the
applications one monitor watches are counted in tens, by hand, and its comment says so.

An archived application is not watched: refreshing it reads nothing, and says so.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
    const app = await this.deps.app.get(appId)
    const previous = await this.repo.latest(appId)
    if (app.archivedAt !== null) return { appId, outcome: 'archived', version: previous?.summary() ?? null }
```

## The workers

Each a `handler`: a job written with the change that tells it, in its transaction, run
until it succeeds ([chapter 11 of the guide](../guide/11-reacting)). Each calls one use
case of its own module, and its queue says which, on which event.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.workers.ts
export function registerStructureWorkers(structures: Structure_Module, deps: Structure_Deps): void {
  structures.hourly.subscribe(() => structures.refreshAll(), {
    strategy: 'handler',
    queue: 'structure.refreshAll.on.structure.hourly',
  })
  deps.app.events.registered.subscribe(app => structures.refresh(app.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.registered',
  })
  deps.app.events.restored.subscribe(app => structures.refresh(app.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.restored',
  })
  deps.app.events.updated.subscribe(({ dto }) => structures.refresh(dto.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.updated',
    when: ({ changed }) => changed.includes('url') || changed.includes('key'),
  })
}
```

`when` keeps a new name from writing a job at all: only a new address or key is a
reason to read again.

A refresh may run twice (a job may): the second finds the same hash, and answers
`unchanged`. That is what makes it safe as a job.

## The button

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.routes.ts
  // The button: read it now.
  base.http.post('/apps/:id/structure/refresh', async request => Response.json(await structures.refresh(request.params.id)))
```

It answers what the refresh came to: `changed`, `unchanged`, `unreachable` (and why) or
`archived`.

## Tests

The schedule's own loop is stopped, once its first look is done, and the test moves the
clock and ticks by hand, as cooper's tests do:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.workers.test.ts
    time += HOUR_MS
    await monitor.monitor.base.schedules.tick()
    await settled()

    expect([await versions(shop.id), await versions(nuke.id), await versions(old.id)]).toEqual([2, 2, 1])
```

`settled` waits for the jobs (`base.jobs.idle()`): never a sleep.

Registering now reads the structure the first time, from a worker, so the tests of the
chapter before wait for it before they look.

## Check it

```sh
bun test packages/newt-monitor
```

```sh
curl -s -b cookies.txt -X POST localhost:4800/api/apps/<id>/structure/refresh
```

```json
{"appId":"…","outcome":"unchanged","version":{"id":"…","hash":"…","takenAt":"…"}}
```

## What to remember

- A schedule is an event: defined by a module, subscribed like any other.
- What must happen after something happens is a `handler`, its queue named after who
  reacts, with what, to which event; `when` keeps a job from being written for nothing.
- A job may run twice: make it find nothing to do the second time.

Next: the catalog.
