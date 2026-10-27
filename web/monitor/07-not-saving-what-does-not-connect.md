# Not saving what does not connect

An application registered with a wrong key, or an address where nobody answers, would
be found out later, as a connection lost, while the one that worked is gone. This
chapter asks first: before an application is registered, and before its address or its
key changes, the monitor asks the endpoint which application it is, signing with the
key. If it does not answer, nothing is saved, and the answer says why.

At the end you will have these files:

```
packages/newt-monitor/src/
  testing/serve-test-app.ts        changed: start, after stop, on the same port
  contexts/monitor/
    initialize-modules.ts          changed: one client, for app and connection
    modules/app/
      app.deps.ts                  the client
      app.module.ts                changed: register and update ask first
      errors/app-does-not-connect.ts
      app.test.ts                  changed: real endpoints, and those that do not answer
```

## The port, not the module

`connection` already asks applications. But `connection` depends on `app` (for where
each one is, and its key): if `app` depended on `connection`, they would depend on
each other, which newt never allows ([golden rule 9](../guide/a-golden-rules)). And
`app` does not need what `connection` keeps: it needs to ask. So it gets the port:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.deps.ts
import type { AppClient } from '../../../../shared/app-client/app-client'

export interface App_Deps {
  /** A port: the applications themselves, asked before an address or a key is saved. */
  client: AppClient
}
```

Both modules get the same client:

```ts
// packages/newt-monitor/src/contexts/monitor/initialize-modules.ts
  const client = deps.client ?? new HttpAppClient()
  const app = App_Module.initialize(base, { client }, { cipher: new KeyCipher(config.secret) })
  const connection = Connection_Module.initialize(base, { app, client })
```

## Asking first

A private method asks, and turns not answering into a domain error, a 400 whose code
says why: `app.unreachable`, `app.key_rejected`, `app.bad_answer`.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  /** Asks the endpoint which application it is, signing with the key: one that does not answer says why. */
  private async connects(endpoint: Endpoint): Promise<void> {
    try {
      await this.deps.client.identity(endpoint)
    } catch (error) {
      if (!(error instanceof AppCallFailed) || error.reason === 'key_unreadable') throw error
      throw new AppDoesNotConnect(error.reason, error.message)
    }
  }
```

Registering asks before saving:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async register(input: unknown): Promise<AppDTO> {
    const fields = AppRegisterSchema.parse(input)
    if (await this.repo.isNameTaken(fields.name)) throw new AppNameTaken(fields.name)
    await this.connects(fields)
```

Changing asks only when the address or the key changes, with what would be saved: the
new one, and the other as it is. A new name asks nothing.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
    if (change.url !== undefined || change.key !== undefined) {
      await this.connects({ url: change.url ?? app.url, key: change.key ?? app.key(this.options.cipher) })
    }
```

A use case that calls outside before its save runs it again on a conflict, call
included. Asking an application which it is changes nothing there, so that is safe:
what cannot be undone is what leaves from a worker ([golden rule
7](../guide/a-golden-rules)).

## Tests

Every test now registers a real endpoint (`serveTestApp`). Those that do not answer:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.test.ts
  test('is not where one is moved: the address and key that answered stay', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }

    const refused = await as(`/api/apps/${id}`, { method: 'PATCH', json: { url: nobody() } })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: 'app.unreachable' })
```

And `connection`'s tests lose an application by stopping it, and get it back by
serving it again on the same port, as a deployment does:

```ts
// packages/newt-monitor/src/testing/serve-test-app.ts
    /** Served again, on the same port, after `stop`: the application back after a deployment. */
    start() {
      server = serveMonitor(contexts, { name, port, key: TEST_APP_KEY })
    },
```

## Check it

```sh
bun test packages/newt-monitor
```

## What to remember

- Check what a client gives against the world before saving it, when it can be: the
  answer says why, and what worked stays.
- Two modules never depend on each other: when one needs only to ask the outside, give
  it the port, not the module that keeps the answers.
- A call outside before the save runs again on a conflict: only calls that change
  nothing there.

Next: [versions of the structure](./08-versions-of-the-structure).
