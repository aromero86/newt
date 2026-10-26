# Tests

Has visto un test al final de casi todos los capítulos. Este va de cómo están hechos:
qué abrir, cómo esperar al trabajo que pasa después y qué tests valen más.

La idea es sencilla. Los tests de cooper ejecutan lo de verdad. Contextos de verdad,
casos de uso de verdad, SQLite de verdad, HTTP de verdad. Dentro de un contexto no se
simula nada. Solo se cambia lo de los bordes: el mailer y, en los tests propios de
boards, auth.

```bash
bun test                                   # todo
bun test cooper/backend/contexts/boards    # un contexto
```

## Una base de datos en memoria que se porta como un fichero

Cada test abre sus stores con la ruta `:memory:`. El store de SQLite de newt la convierte
en un fichero temporal que se borra al cerrar el store. Así, un test tiene exactamente lo
mismo que producción: un escritor y un lector con WAL, transacciones que se turnan, las
mismas migraciones. Cada test empieza con una base de datos vacía y no deja nada detrás.

La configuración sale de `config.ts`, con las rutas y los puertos cambiados:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, dbPath: ':memory:', port: 0 },
    boards: { ...config.boards, dbPath: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, dbPath: ':memory:', port: 0, trace: false },
  }
}
```

El puerto `0` le pide al sistema uno libre cualquiera. Cuando un contexto tiene que
conocer la dirección de otro antes de abrirse (boards manda a la gente a la URL de auth),
el test busca antes un puerto libre:

```ts
// cooper/backend/cooper.test.ts
/** A port nobody listens on now: each context must know the other's address before it opens. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port!
  void probe.stop()
  return port
}
```

## Tres tamaños de test

cooper prueba a tres tamaños. Cada contexto tiene una carpeta `testing/` con lo que
abren sus tests.

**Un contexto, con sus vecinos simulados.** Los módulos de boards se prueban sin auth.
Su `testing/fake-auth.ts` implementa los puertos que boards recibe (quién pertenece a
cada espacio de trabajo) y publica los eventos de auth (`tenant.created`,
`tenant.deleted`, `access.revoked`) como lo hace auth: en una transacción de su propio
store, para que los handlers de boards sean jobs de un outbox, como en producción.

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, its
 * emails in a list, and who sends a request told by an `x-user` header (the real
 * authenticator, the web session's, is replaced).
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mails: Mail[] = []
  const boards = await Boards_Context.open({ ...config.boards, dbPath: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
    auth: auth.modules,
    mailer: { send: async mail => { mails.push(mail) } },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId } : null
  })
  // …
}
```

Un falso solo es posible porque boards llega a auth por puertos que declara él
(`member.deps.ts`, `workspace.deps.ts`, `card.deps.ts`). Un módulo que importara el
repositorio de auth no se podría probar así.

**Un contexto con los de verdad que lee.** El backoffice lee de auth y de boards, así que
sus tests abren los tres, como el servidor, con `openContexts`, y crean los datos con los
casos de uso de auth y de boards:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
export async function openTestBackoffice() {
  const contexts = await openContexts(testConfig(), { mailer: { send: async () => {} } })
  const { auth, boards, backoffice } = contexts

  /** An account, as someone signs up in auth. */
  const signUp = (name: string): Promise<UserDTO> =>
    auth.modules.user.signUp({ email: `${name.toLowerCase()}@cooper.test`, name, password: 'a long password' })

  return {
    // …
    as<T>(user: UserDTO, fn: () => Promise<T>): Promise<T> {
      return runAsActor({ userId: user.id }, fn)
    },
    // …
  }
}
```

Los casos de uso se llaman directamente, como alguien, con `runAsActor`: sin HTTP y sin
sesión.

**La aplicación entera, por HTTP.** `cooper/backend/cooper.test.ts` abre todos los
contextos, sirve auth y boards en puertos de verdad y hace de navegador: guarda las
cookies de cada origen y nunca sigue una redirección por su cuenta. Da de alta a la gente
por el flujo OAuth real, crea espacios con las rutas de boards, acepta una invitación con
el enlace leído del email y conecta un cliente MCP:

```ts
// cooper/backend/cooper.test.ts
/** Someone signs up to cooper from boards, as its UI does it: boards' sign-in, auth's pages, back to boards. */
async function signUp(email: string, name: string): Promise<{ as: Browser, id: string }> {
  const as = browser()
  const started = await as(boardsUrl('/api/session/sign-in?returnTo=/'))
  const kept = await as(started.headers.get('location')!)
  const request = kept.headers.get('location')!.split('/authorize/')[1]!
  const user = (await (await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email, name, password: 'a long password' } })).json()) as { id: string }
  const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${request}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
  expect((await as(redirectTo)).headers.get('location')).toBe('/')
  return { as, id: user.id }
}
```

Los tests pequeños te dicen qué regla se ha roto. El grande te dice que las piezas
encajan.

## Esperar a los workers

Con consistencia eventual, justo después de crear un espacio de trabajo su tablero de
bienvenida aún no existe. Un test tiene que esperar al trabajo de fondo, y **nunca con un
sleep**. Un sleep se queda corto en una máquina lenta y pierde tiempo en una rápida.

`base.jobs.idle()` vuelve cuando no queda ningún trabajo listo ni en marcha. Ejecuta él
mismo los trabajos listos, así que un test ni siquiera necesita arrancar el worker:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('gives a new workspace its welcome board, a moment after auth creates it', async () => {
  await t.auth.createWorkspace('acme', 'ana')
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)

  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['Welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
})
```

Dos cosas que `idle()` no espera:

- **Una reacción `'fire-and-forget'`** no es un job. Un test que la escucha necesita un
  instante o, como hace el test de auth, recoger lo que oyó tras un `idle()` que cubrió
  los guardados que la publicaron.
- **Un job que falló y espera su reintento** (a los 10 segundos, y después más) sigue
  pendiente cuando `idle()` vuelve. Si un test provoca fallos, mira los jobs:
  `base.store.outbox.list()`.

### En el orden correcto, entre contextos

Un job `handler` se escribe en la transacción del cambio que publica el evento. Así que
vive en el outbox del contexto que **publica**, no en el del que reacciona. La reacción
de boards a `tenant.created` es un job del outbox de auth, y lo ejecuta el worker de
auth. El recuento de `card.created` del backoffice es un job del de boards.

El trabajo fluye así: auth crea un espacio → el job de auth prepara el tablero de
bienvenida en boards → el guardado de boards publica `card.created` → el job de boards
añade la métrica. Para verlo todo, espera primero a auth y después a boards:

```ts
// cooper/backend/cooper.test.ts
/** Until the background work is done: auth's jobs (boards' reactions to auth's events among them), then boards'. */
async function settled() {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}
```

Espéralos al revés y el test verá el tablero de bienvenida, pero no su métrica. El
helper del backoffice recorre todos los contextos, en el orden en que se abren, dos
veces, para cubrir también una cadena que vuelva a auth:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
/**
 * Until the background work is done, in the order it flows: auth's events (heard
 * by boards and by the metrics), then boards' (the cards the metrics count).
 */
async settled(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (const context of contexts.all) await context.base.jobs.idle()
  }
},
```

## Probar lo difícil

Los tests que más valen son los de las situaciones que temían los capítulos anteriores.
Son también los que nadie prueba haciendo clic.

**Concurrencia.** Veinte cards creadas a la vez en un tablero reciben veinte números
distintos y veinte posiciones distintas ([capítulo 9](./09-shared-counters)):

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('gives distinct numbers and places to cards created at once', async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

  const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
  expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))
})
```

Y cuatro tableros creados a la vez con el mismo nombre en mayúsculas distintas dejan
exactamente uno ([capítulo 8](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('gives a name to one of several boards created with it at once, whatever its case', async () => {
  const created = await Promise.allSettled(['Roadmap', 'ROADMAP', 'roadmap', 'RoadMap'].map(create))

  expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(1)
  for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'board.name_taken' })
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
})
```

**Repetición.** Un worker puede ejecutarse dos veces, o pararse a mitad y volver a
empezar ([capítulo 13](./13-repeatable-workers)). El test hace exactamente eso: una
primera vuelta que dejó un tablero y una columna, y después el evento dos veces:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('prepares a workspace once, however many times its work runs, and finishes one left halfway', async () => {
  t.auth.join('acme', 'ana')
  // A first run that stopped halfway: the board and one column.
  const board = await inAcme(() => t.modules.board.create({ name: 'welcome' }))
  await inAcme(() => t.modules.column.add(board.id, { name: 'To do' }))

  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()
  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
})
```

La limpieza tras un borrado también se ejecuta dos veces, y el test comprueba que todos
los jobs acabaron `done`: nada que quitar, nada que falle.

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
// Its work run again, as after a failure halfway: nothing left to remove, nothing fails.
await t.auth.deleteWorkspace('acme')
await t.settled()
expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done'])
```

**Flujos de seguridad.** OAuth va sobre todo de lo que hay que rechazar. Los tests de auth
los recorren por HTTP, como lo haría un cliente: un código canjeado dos veces revoca los
tokens que dio (desde un worker, así que el test espera), un refresh token que vuelve
después de haber sido sustituido revoca los nuevos, un código sin su verificador PKCE se
rechaza.

```ts
// cooper/backend/contexts/auth/oauth.test.ts
test('trades a code once: brought again, the tokens it gave are revoked, from a worker', async () => {
  const clientId = await register()
  const { verifier, challenge } = pkce()
  const code = await codeFor(clientId, challenge)
  const exchange = () => token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK })

  const first = (await (await exchange()).json()) as { access_token: string }
  const again = await exchange()
  expect(again.status).toBe(400)
  expect(await again.json()).toMatchObject({ error: 'invalid_grant' })
  await auth.base.jobs.idle()
  expect(await auth.modules.token.verify(first.access_token)).toBeNull()
})
```

Los tests de la sesión web comprueban que se rechaza un callback que el navegador no
empezó, y que un `returnTo` que apunta a otro sitio manda al navegador a la portada.

**Las reglas del framework.** Un caso de uso que escribe en otro módulo fuera de un
worker falla ([capítulo 17](./17-modules-talk)). Es lo que pasa por defecto, así que un
test que pasa por ese camino falla el día que lo escribes, no en producción.

## Un test que no puede fallar no prueba nada

Cuando un test pasa a la primera, rompe el código a propósito una vez: quita el `guard`
de un guardado, el `escape` de la búsqueda, el `where` con el espacio de trabajo. Ejecuta
el test y míralo fallar. Después deja el código como estaba. Un test que nunca has visto
fallar puede no estar probando lo que crees.

## En resumen

- Prueba lo de verdad: contextos de verdad, SQLite de verdad en `:memory:`, HTTP de
  verdad. Simula solo en los bordes, detrás de los puertos que declara un contexto.
- Cada contexto guarda sus ayudas para tests en `testing/`.
- Espera a los workers con `jobs.idle()`, nunca con un sleep.
- Un job vive en el outbox del contexto que publica el evento: espera a los contextos
  en el orden en que fluye el trabajo.
- Gasta tus tests en lo difícil: cosas a la vez, cosas dos veces, cosas rechazadas.
- Rompe el código una vez para ver fallar el test.
