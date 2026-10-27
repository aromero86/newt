# Hablar con una aplicación

El monitor sabe dónde está cada aplicación y guarda su clave. Este capítulo le
pregunta: una petición a su endpoint de monitor, firmada con la clave, que nunca viaja.
El módulo `connection` registra cada vez si respondió, quién respondió (qué proceso,
qué versión de newt) y, si no, por qué. Dice cuándo se pierde una aplicación, y cuándo
vuelve.

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/
  shared/app-client/
    app-client.ts                 el puerto: lo que el monitor pregunta a una aplicación
    app-call-failed.ts            por qué no respondió
    http-app-client.ts            el puerto sobre HTTP, cada petición firmada
    http-app-client.test.ts
  testing/
    serve-test-app.ts             una aplicación newt para un test, con su endpoint de monitor
  contexts/monitor/
    initialize-modules.ts         cambia: el módulo connection, y su cliente
    migrations/sqlite/
      00004_connection_up.sql
      00004_connection_down.sql
    modules/app/
      app.module.ts               cambia: endpointOf
    modules/connection/
      connection.schema.ts        la conexión, la identidad, el fallo
      connection.ts               la entidad: cada llamada registrada, perdida y recuperada
      connection.repository.ts
      connection.deps.ts          el módulo app, y el cliente
      connection.module.ts        check, fetchStructure, status
      connection.routes.ts
      events/connection-lost.ts
      events/connection-restored.ts
      connection.test.ts
```

## Un puerto, esta vez

Otro módulo del monitor es una dep tal cual, nunca envuelto en funciones
([capítulo 20 de la guía](../guide/20-wiring-contexts)). Una aplicación que vigila el
monitor no es un módulo suyo: está en otro sitio, al otro lado de la red. Para eso es
un puerto, con las palabras del propio monitor:

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

Su adaptador firma cada petición con `signMonitorRequest`
([apéndice H](../guide/h-describe-application)), espera como mucho cinco segundos, y
convierte cada forma de no responder en un solo error que dice cuál: nadie al otro lado,
la clave rechazada, o una respuesta que no es de un endpoint de monitor.

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

Lo que responde una aplicación se comprueba antes de creerlo: una respuesta que no es lo
que dice un endpoint de monitor es `bad_answer`, no un error del monitor.

## La clave, abierta solo para firmar

`connection` necesita la clave en claro, una vez, para firmar. El módulo app la da con
un caso de uso al que no responde ninguna ruta:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async endpointOf(id: string): Promise<Endpoint> {
    const app = await this.load(id)
    return { url: app.url, key: app.key(this.options.cipher) }
  }
```

## La conexión

Una fila por aplicación: su último estado, su identidad tal como respondió la última
vez, por qué no respondió, cuándo se le preguntó por última vez y cuándo respondió por
última vez.

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

La identidad y el fallo son objetos: la tabla dice que son JSON, y el store los guarda
como texto (`types: { identity: 'json', failure: 'json' }`).

La entidad registra cada llamada, y solo dice lo que cambió: caída, desde activa o desde
no haber respondido nunca, es `connection.lost`; activa, desde caída, es
`connection.restored`. Preguntar a una que sigue caída no dice nada más.

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

## El módulo

Todas las llamadas pasan por un método privado: abre la clave, llama, y convierte no
responder en un fallo que registrar, nunca en un error que detiene el caso de uso:

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

`check` pregunta qué aplicación es; `fetchStructure`, de qué está hecha, para los
capítulos que vienen. Los dos registran la llamada.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.routes.ts
export function registerConnectionRoutes(base: MonitorBase, connections: Connection_Module): void {
  base.http.get('/apps/:id/connection', async request => Response.json(await connections.status(request.params.id)))

  base.http.post('/apps/:id/connection/check', async request => Response.json(await connections.check(request.params.id)))
}
```

El contexto le da al módulo su cliente: HTTP, salvo que quien lo abre le dé otro
(`Monitor_ModuleDeps`).

## Una aplicación para los tests

Los tests preguntan a una aplicación newt de verdad, con un endpoint de monitor de
verdad: `serveTestApp` construye una a partir de formas (un contexto, sus módulos, sus
casos de uso y sus eventos), la sirve en un puerto libre con `serveMonitor`, y deja que
un test añada y quite contextos, como haría un despliegue.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.test.ts
  test('records why it did not answer, tells it is lost, and that it is back', async () => {
    await check()
    await as(`/api/apps/${id}`, { method: 'PATCH', json: { key: 'not the key the application has, but long' } })

    const refused = await check()
    expect(refused).toMatchObject({ status: 'down', failure: { reason: 'key_rejected' } })
```

## Compruébalo

```sh
bun test packages/newt-monitor
```

Con cooper sirviendo su endpoint de monitor (`COOPER_MONITOR_KEY`, puerto 3010),
regístralo con esa clave y pregúntale:

```sh
curl -s -b cookies.txt -X POST localhost:4800/api/apps/<id>/connection/check
```

```json
{"appId":"…","status":"up","identity":{"name":"cooper","newt":"0.0.0","instance":{…}},"failure":null,…}
```

## Qué recordar

- Otro módulo es una dep; algo fuera de la aplicación es un puerto, con un adaptador, y
  uno falso o uno real en los tests.
- Una llamada hacia fuera puede fallar de muchas formas: di cuál, regístralo, y deja que
  el caso de uso siga.
- Un evento dice un cambio: perdida una vez, recuperada una vez, por muchas veces que se
  pregunte.

Siguiente: [no guardar lo que no conecta](./07-not-saving-what-does-not-connect).
