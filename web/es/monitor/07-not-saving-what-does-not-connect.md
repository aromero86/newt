# No guardar lo que no conecta

Una aplicación registrada con una clave equivocada, o con una dirección donde nadie
responde, se descubriría más tarde, como una conexión perdida, cuando la que funcionaba
ya no está. Este capítulo pregunta antes: antes de registrar una aplicación, y antes de
que cambien su dirección o su clave, el monitor pregunta al endpoint qué aplicación es,
firmando con la clave. Si no responde, no se guarda nada, y la respuesta dice por qué.

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/
  testing/serve-test-app.ts        cambia: start, después de stop, en el mismo puerto
  contexts/monitor/
    initialize-modules.ts          cambia: un cliente, para app y connection
    modules/app/
      app.deps.ts                  el cliente
      app.module.ts                cambia: register y update preguntan antes
      errors/app-does-not-connect.ts
      app.test.ts                  cambia: endpoints reales, y los que no responden
```

## El puerto, no el módulo

`connection` ya pregunta a las aplicaciones. Pero `connection` depende de `app` (para
saber dónde está cada una, y su clave): si `app` dependiera de `connection`, dependerían
el uno del otro, algo que newt nunca permite ([regla de oro 9](../guide/a-golden-rules)).
Y `app` no necesita lo que guarda `connection`: necesita preguntar. Así que recibe el
puerto:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.deps.ts
import type { AppClient } from '../../../../shared/app-client/app-client'

export interface App_Deps {
  /** A port: the applications themselves, asked before an address or a key is saved. */
  client: AppClient
}
```

Los dos módulos reciben el mismo cliente:

```ts
// packages/newt-monitor/src/contexts/monitor/initialize-modules.ts
  const client = deps.client ?? new HttpAppClient()
  const app = App_Module.initialize(base, { client }, { cipher: new KeyCipher(config.secret) })
  const connection = Connection_Module.initialize(base, { app, client })
```

## Preguntar antes

Un método privado pregunta, y convierte no responder en un error del dominio, un 400
cuyo código dice por qué: `app.unreachable`, `app.key_rejected`, `app.bad_answer`.

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

Registrar pregunta antes de guardar:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async register(input: unknown): Promise<AppDTO> {
    const fields = AppRegisterSchema.parse(input)
    if (await this.repo.isNameTaken(fields.name)) throw new AppNameTaken(fields.name)
    await this.connects(fields)
```

Cambiar pregunta solo cuando cambian la dirección o la clave, con lo que se guardaría:
la nueva, y la otra tal como está. Un nombre nuevo no pregunta nada.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
    if (change.url !== undefined || change.key !== undefined) {
      await this.connects({ url: change.url ?? app.url, key: change.key ?? app.key(this.options.cipher) })
    }
```

Un caso de uso que llama hacia fuera antes de guardar se ejecuta otra vez ante un
conflicto, llamada incluida. Preguntar a una aplicación cuál es no cambia nada allí, así
que es seguro: lo que no se puede deshacer es lo que sale de un worker ([regla de oro
7](../guide/a-golden-rules)).

## Tests

Ahora todos los tests registran un endpoint real (`serveTestApp`). Los que no responden:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.test.ts
  test('is not where one is moved: the address and key that answered stay', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }

    const refused = await as(`/api/apps/${id}`, { method: 'PATCH', json: { url: nobody() } })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: 'app.unreachable' })
```

Y los tests de `connection` pierden una aplicación deteniéndola, y la recuperan
sirviéndola otra vez en el mismo puerto, como hace un despliegue:

```ts
// packages/newt-monitor/src/testing/serve-test-app.ts
    /** Served again, on the same port, after `stop`: the application back after a deployment. */
    start() {
      server = serveMonitor(contexts, { name, port, key: TEST_APP_KEY })
    },
```

## Compruébalo

```sh
bun test packages/newt-monitor
```

## Qué recordar

- Comprueba lo que da un cliente contra el mundo antes de guardarlo, cuando se pueda: la
  respuesta dice por qué, y lo que funcionaba se queda.
- Dos módulos nunca dependen el uno del otro: cuando uno solo necesita preguntar fuera,
  dale el puerto, no el módulo que guarda las respuestas.
- Una llamada hacia fuera antes de guardar se ejecuta otra vez ante un conflicto: solo
  llamadas que no cambian nada allí.

Siguiente: [versiones de la estructura](./08-versions-of-the-structure).
