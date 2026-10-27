# Talking to an application

The monitor knows where each application is and holds its key. This chapter asks it:
a request to its monitor endpoint, signed with the key, which never travels. The
`connection` module records each time whether it answered, who answered (which
process, which version of newt), and if not, why. It tells when an application is
lost, and when it is back.

At the end you will have these files:

```
packages/newt-monitor/src/
  shared/app-client/
    app-client.ts                 the port: what the monitor asks an application
    app-call-failed.ts            why it did not answer
    http-app-client.ts            the port over HTTP, each request signed
    http-app-client.test.ts
  testing/
    serve-test-app.ts             a newt application for a test, with its monitor endpoint
  contexts/monitor/
    initialize-modules.ts         changed: the connection module, and its client
    migrations/sqlite/
      00004_connection_up.sql
      00004_connection_down.sql
    modules/app/
      app.module.ts               changed: endpointOf
    modules/connection/
      connection.schema.ts        the connection, the identity, the failure
      connection.ts               the entity: each call recorded, lost and restored
      connection.repository.ts
      connection.deps.ts          the app module, and the client
      connection.module.ts        check, fetchStructure, status
      connection.routes.ts
      events/connection-lost.ts
      events/connection-restored.ts
      connection.test.ts
```

## A port, this time

Another module of the monitor is a dep as it is, never wrapped in functions
([chapter 20 of the guide](../guide/20-wiring-contexts)). An application the monitor
watches is no module of it: it is somewhere else, over the network. That is what a
port is for, in the monitor's own words:

```ts
// packages/newt-monitor/src/shared/app-client/app-client.ts
/** Where an application's monitor endpoint is, and the key to sign with. */
export type Endpoint = { url: string, key: string }

/**
 * What the monitor asks an application, through its monitor endpoint
 * (`serveMonitor`): a port, since an application is no module of the monitor's. Each
 * call either answers or throws `AppCallFailed`, which says why.
 */
export interface AppClient {
  /** Which application, and which process of it. */
  identity(endpoint: Endpoint): Promise<MonitorIdentity>
  /** What it is made of, as `describeApplication` says it. */
  structure(endpoint: Endpoint): Promise<ApplicationDescription>
}
```

Its adapter signs each request with `signMonitorRequest`
([appendix H](../guide/h-describe-application)), waits five seconds at most, and turns
every way of not answering into one error that says which: nobody there, the key
refused, or an answer that is no monitor endpoint's.

```ts
// packages/newt-monitor/src/shared/app-client/http-app-client.ts
  private async get(endpoint: Endpoint, path: string): Promise<unknown> {
    const url = `${endpoint.url}${path}`
    let response: Response
    try {
      response = await fetch(url, { headers: signMonitorRequest(endpoint.key, { url }), signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      throw new AppCallFailed('unreachable', `Nobody answered at ${endpoint.url}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.status === 401) throw new AppCallFailed('key_rejected', `${endpoint.url} refused the signature: the key is not the application's`)
    if (!response.ok) throw new AppCallFailed('bad_answer', `${endpoint.url} answered ${response.status}: is it a monitor endpoint?`)
```

What an application answers is checked before it is believed: an answer that is not
what a monitor endpoint says is `bad_answer`, not an error of the monitor's.

## The key, opened only to sign

`connection` needs the key in the clear, once, to sign. The app module gives it
through a use case no route answers:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async endpointOf(id: string): Promise<Endpoint> {
    const app = await this.load(id)
    return { url: app.url, key: app.key(this.options.cipher) }
  }
```

## The connection

One row per application: its last status, its identity as it last answered, why it
did not, when it was last asked and when it last answered.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.schema.ts
export const ConnectionSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  status: z.enum(['up', 'down']),
  identity: IdentitySchema.nullable().default(null),
  failure: FailureSchema.nullable().default(null),
  /** When it was last asked. */
  checkedAt: z.iso.datetime(),
  /** When it last answered: null if it never has. */
  lastSeenAt: z.iso.datetime().nullable().default(null),
```

The identity and the failure are objects: the table says they are JSON, and the store
keeps them as text (`types: { identity: 'json', failure: 'json' }`).

The entity records each call, and tells only what changed: down, from up or from never
having answered, is `connection.lost`; up, from down, is `connection.restored`. Asking
one that stays down tells nothing more.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.ts
  record(outcome: Outcome, first = false): void {
    const at = now().toISOString()
    const wasDown = !first && this.data.status === 'down'
    if (outcome.answered) {
      this.change({ status: 'up', failure: null, checkedAt: at, lastSeenAt: at, ...(outcome.identity ? { identity: outcome.identity } : {}) })
      if (wasDown) this.trackEvent(new Connection_Restored({ appId: this.data.appId, failure: null }))
    } else {
      const wasUp = first || this.data.status === 'up'
      this.change({ status: 'down', failure: outcome.failure, checkedAt: at })
      if (wasUp) this.trackEvent(new Connection_Lost({ appId: this.data.appId, failure: outcome.failure }))
    }
  }
```

## The module

Every call goes through one private method: it opens the key, calls, and turns not
answering into a failure to record, never an error that stops the use case:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.module.ts
  private async call<T>(appId: string, ask: (endpoint: Endpoint) => Promise<T>): Promise<Called<T>> {
    try {
      return { answered: true, value: await ask(await this.deps.app.endpointOf(appId)) }
    } catch (error) {
      if (error instanceof AppCallFailed) return { answered: false, failure: { reason: error.reason, message: error.message } }
      if (error instanceof SealedKeyUnreadable) return { answered: false, failure: { reason: 'key_unreadable', message: error.message } }
      throw error
    }
  }
```

`check` asks which application it is; `fetchStructure`, what it is made of, for the
chapters to come. Both record the call.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.routes.ts
export function registerConnectionRoutes(base: MonitorBase, connections: Connection_Module): void {
  base.http.get('/apps/:id/connection', async request => Response.json(await connections.status(request.params.id)))

  base.http.post('/apps/:id/connection/check', async request => Response.json(await connections.check(request.params.id)))
}
```

The context gives the module its client: HTTP, unless whoever opens it gives another
(`Monitor_ModuleDeps`).

## An application for the tests

The tests ask a real newt application, with a real monitor endpoint: `serveTestApp`
builds one from shapes (a context, its modules, their use cases and events), serves it
on a free port with `serveMonitor`, and lets a test add and remove contexts, as a
deployment would.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.test.ts
  test('records why it did not answer, tells it is lost, and that it is back', async () => {
    await check()
    await as(`/api/apps/${id}`, { method: 'PATCH', json: { key: 'not the key the application has, but long' } })

    const refused = await check()
    expect(refused).toMatchObject({ status: 'down', failure: { reason: 'key_rejected' } })
```

## Check it

```sh
bun test packages/newt-monitor
```

With cooper serving its monitor endpoint (`COOPER_MONITOR_KEY`, port 3010), register
it with that key and ask it:

```sh
curl -s -b cookies.txt -X POST localhost:4800/api/apps/<id>/connection/check
```

```json
{"appId":"…","status":"up","identity":{"name":"cooper","newt":"0.0.0","instance":{…}},"failure":null,…}
```

## What to remember

- Another module is a dep; something outside the application is a port, with an
  adapter, and a fake or a real one in tests.
- A call outside can fail in many ways: say which, record it, and let the use case go
  on.
- An event tells a change: lost once, restored once, however many times it is asked.

Next: [not saving what does not connect](./07-not-saving-what-does-not-connect).
