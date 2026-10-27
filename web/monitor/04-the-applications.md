# The applications

The monitor watches applications: this chapter keeps them. The `app` module registers
one with a name, the address of its monitor endpoint and its key; lists them; shows
one; and changes any of the three. The key is sealed with the chapter before's
`KeyCipher`, and no answer ever shows it.

At the end you will have these files:

```
packages/newt-monitor/src/contexts/monitor/
  initialize-modules.ts         changed: the app module, with the cipher
  migrations/sqlite/
    00002_app_up.sql            the app table
    00002_app_down.sql
  modules/app/
    app.schema.ts               the application, what it shows, what a client sends
    app.ts                      the entity: it seals its key, and opens it
    app.repository.ts           a name is one application's
    app-options.ts              the cipher
    app.module.ts               register, list, get, update
    app.routes.ts               /api/apps
    events/app-registered.ts
    events/app-updated.ts
    errors/app-not-found.ts
    errors/app-name-taken.ts
    app.test.ts
```

## The table

```sql
-- packages/newt-monitor/src/contexts/monitor/migrations/sqlite/00002_app_up.sql
-- The applications the monitor watches: where their monitor endpoint is, and their key,
-- sealed with the monitor's secret (never the key itself).
CREATE TABLE app (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  sealed_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- A name is one application's, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX app_name ON app (lower(name));
```

## Its schemas: what it keeps, what it shows

The entity keeps the sealed key; anyone else sees everything but it. newt calls that
a public schema: `toDTO` gives only its fields, the repository stores them all
([chapter 17 of the guide](../guide/17-auth) does it with a password's hash).

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.schema.ts
/** An application the monitor watches, as it keeps it: its key sealed (`KeyCipher`), never the key. */
export const AppSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(100),
  /** Where its monitor endpoint is (`serveMonitor`): `http://cooper:3010`. */
  url: z.url({ protocol: /^https?$/ }),
  sealedKey: z.string().min(1),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What anyone sees of it: everything but its key. */
export const AppPublicSchema = AppSchema.omit({ sealedKey: true })
```

What a client sends is checked by the input schemas, derived from the entity's: an
address with no query, kept without its last `/`, and a key as long as `serveMonitor`
asks:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.schema.ts
/** What a client sends to register one. */
export const AppRegisterSchema = z.object({
  name: AppSchema.shape.name,
  url: EndpointUrlSchema,
  key: AppKeySchema,
})

/** What a client sends to change one: any of them, at least one. */
export const AppUpdateSchema = AppRegisterSchema.partial()
  .refine(change => Object.values(change).some(value => value !== undefined), 'Say what changes: name, url or key')
```

## The entity seals its own key

The key is sealed for the application's id ([chapter 3](./03-a-secret-that-encrypts)),
so the entity makes its id before it seals. Only the entity seals and opens it:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.ts
  static register({ name, url, key }: Fields, cipher: KeyCipher): App {
    const id = Bun.randomUUIDv7()
    const app = new App({ id, name, url, sealedKey: cipher.seal(key, id) }, true)
    app.trackEvent(new App_Registered(app.toDTO()))
    return app
  }
```

A change says which fields changed, `key` among them, never its value: `app.updated`
tells whoever listens that the key is another, and nothing more.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.ts
  /** Changes what is given and differs; tells which fields did, if any. */
  update(change: Partial<Fields>, cipher: KeyCipher): void {
    const changed: ('name' | 'url' | 'key')[] = []
    if (change.name !== undefined && change.name !== this.data.name) changed.push('name')
    if (change.url !== undefined && change.url !== this.data.url) changed.push('url')
    if (change.key !== undefined && change.key !== this.key(cipher)) changed.push('key')
    if (changed.length === 0) return
```

## A name is one application's

The rule of [chapter 6 of the guide](../guide/06-rules-over-rows), for a name: the
use case checks first, for the clear answer; the save counts again under a guard, in
its transaction; the unique index has the last word. Two registrations of `cooper` and
`COOPER` at once: one gets a 201, the other a 409 `app.name_taken`.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async register(input: unknown): Promise<AppDTO> {
    const fields = AppRegisterSchema.parse(input)
    if (await this.repo.isNameTaken(fields.name)) throw new AppNameTaken(fields.name)
    const app = App.register(fields, this.options.cipher)
    await this.repo.persistWithNameFree(app)
    return app.toDTO()
  }
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.repository.ts
  async persistWithNameFree(app: App): Promise<void> {
    const { name } = app
    await this.save([app], each => this.write(each), {
      guard: [`appName:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new AppNameTaken(name)
      },
    })
  }
```

## The routes

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.routes.ts
export function registerAppRoutes(base: MonitorBase, apps: App_Module): void {
  base.http.get('/apps', async request => Response.json(await apps.list(pageRequestFrom(request))))

  base.http.post('/apps', async request => Response.json(await apps.register(await request.json()), { status: 201 }))

  base.http.get('/apps/:id', async request => Response.json(await apps.get(request.params.id)))

  base.http.patch('/apps/:id', async request => Response.json(await apps.update(request.params.id, await request.json())))
}
```

None is public: the session of [chapter 2](./02-signing-in) guards them all.

## Tests

The key is what matters: no answer has it, and its row has only the sealed text.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.test.ts
  test('keeps the key sealed in its row, never as it was given', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }

    const [row] = await monitor.monitor.base.store.table<AppRow>('app').find({ id })
    expect(row!.sealedKey).toStartWith('v1.')
    expect(row!.sealedKey).not.toContain(COOPER.key)
  })
```

And a name taken at once, an address that is no `http` one, a key too short, a change
that says nothing, and nobody signed in.

## Check it

```sh
bun test packages/newt-monitor
```

With the monitor running and signed in (the cookie of chapter 2 in `cookies.txt`):

```sh
curl -s -b cookies.txt localhost:4800/api/apps -H 'content-type: application/json' \
  -d '{"name":"cooper","url":"http://localhost:3010","key":"cooper'"'"'s monitor key, long enough to sign"}'
```

## What to remember

- A secret the entity keeps goes through its public schema: `toDTO` never has it.
- The entity seals and opens its own key, bound to its id.
- A name unique among rows: check first, count again under a guard, and an index.
- An event about a secret says that it changed, never what it is.

Next: archiving, restoring, deleting.
