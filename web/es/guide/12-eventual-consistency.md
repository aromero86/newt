# Consistencia eventual: el tablero de bienvenida

Cuando alguien crea un workspace en cooper, no debería abrirse vacío. Recibe un
tablero llamado "Welcome", con tres columnas y una tarjeta que enseña cómo funciona
todo. El workspace es de auth; el tablero, de boards. Este capítulo sigue a ese
tablero desde la petición que crea el workspace hasta el momento en que aparece, y
muestra qué ve el cliente entre medias.

## Dos formas de estar al día

Cuando responde la petición que crea un workspace, puede ser cierta una de dos cosas:

- **Consistencia inmediata**: la petición crea el workspace y su tablero de
  bienvenida, y solo entonces responde. Cuando el cliente recibe la respuesta, todo
  está ahí.
- **Consistencia eventual**: la petición crea el workspace y responde. Un worker crea
  el tablero de bienvenida un instante después. Durante ese instante, el workspace
  existe y no tiene tablero.

cooper usa la segunda. Aquí ni siquiera es una elección:

- **El workspace y el tablero están en bases de datos distintas.** auth guarda sus
  datos en `data/cooper-auth.db`; boards, en `data/cooper-boards.db`. Ninguna
  transacción abarca las dos. Incluso dentro de un mismo store, hacerlo todo de golpe
  ataría dos módulos para siempre ([módulos que hablan](./17-modules-talk) explica la
  regla).
- **La petición no espera a nadie.** Si preparar el tablero fuera lento, quien crea el
  workspace no lo notaría.
- **No se pierde nada.** Si el servidor se para justo después de guardar el workspace,
  el job que prepara su tablero está guardado con él, y se ejecuta al volver.

## El viaje de un workspace

1. El cliente envía `POST /api/workspaces` a boards. La ruta llama al `tenant.create`
   de auth.
2. auth guarda el workspace en una transacción. Con él guarda los jobs de cada
   `'handler'` suscrito a `tenant.created`: `tenant.ensureAdmin…` y
   `workspace.prepare…`.
3. auth guarda el acceso de admin de quien lo creó en una segunda transacción.
4. La ruta responde `201` con el workspace. El cliente ya tiene su respuesta.
5. El worker de auth se despierta tras el commit, reclama
   `workspace.prepare.on.tenant.created` y llama al `workspace.prepare` de boards con
   el id del workspace.
6. `prepare` crea el tablero, sus columnas y su tarjeta, cada cosa en una transacción
   corta propia.
7. El cliente vuelve a pedir los tableros del workspace, y "Welcome" está ahí.

Cada paso que toca un store es una transacción corta propia. Y cada vez que una de
ellas deja un job pendiente, el job se guarda con ella.

## El código

La ruta es de boards, pero el workspace es de auth: la ruta llama directamente al
caso de uso de auth, como lo haría cualquier cliente ([varios
contextos](./19-several-contexts) explica por qué se permite).

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
base.http.post('/workspaces', async request => {
  const created = await tenant.create(await request.json() as TenantCreateDTO)
  return Response.json(workspaceOf(created, currentActor().userId), { status: 201 })
})
```

El caso de uso de auth guarda el workspace, que cuenta `tenant.created`:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async create(input: TenantCreateDTO): Promise<TenantDTO> {
  const { name } = TenantCreateSchema.parse(input)
  const tenant = Tenant.create({ name, createdBy: currentActor().userId })
  await this.repo.persist(tenant)
  await this.admitAdmin(tenant.toDTO())
  return tenant.toDTO()
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.ts
static create(input: { name: string, createdBy: string }): Tenant {
  const tenant = new Tenant(input, true)
  tenant.trackEvent(new Tenant_Created(tenant.toDTO()))
  return tenant
}
```

boards escucha. Su módulo de workspace se suscribe en el emisor de auth, así que el
job se guarda en la transacción de auth:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
/**
 * boards follows auth's workspaces, a moment later: a new one gets its welcome board,
 * and a deleted one loses everything it had here. Each reaction is a job of auth's
 * worker, saved with the change that tells it, and run until it completes.
 */
export function registerWorkspaceWorkers(workspace: Workspace_Module, deps: Workspace_Deps): void {
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
  // …
}
```

Y el worker llama al caso de uso que prepara el tablero:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
/**
 * A new workspace gets its welcome board: "Welcome", with To do, Doing and Done, and
 * a first card. A worker calls it once auth created the workspace (eventual
 * consistency: for a moment, the workspace has no board), and it writes in three
 * modules, which only a worker may (ch. 19): if it fails halfway, its job runs it
 * again. Each step looks for what an earlier run did first, so a second run only
 * finishes what the first left (ch. 15), and adds nothing to a finished one.
 */
@UseCase()
async prepare(workspaceId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const board = await this.deps.board.findByName(WELCOME_BOARD.name)
      ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
    const columns = await this.deps.column.list(board.id)
    for (const name of WELCOME_BOARD.columns) {
      if (!columns.some(column => column.name === name)) columns.push(await this.deps.column.add(board.id, { name }))
    }
    if ((await this.deps.card.listInBoard(board.id)).length > 0) return
    const todo = columns.find(column => column.name === WELCOME_BOARD.columns[0])!
    await this.deps.card.create(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
  })
}
```

`prepare` escribe en tres módulos: tablero, columna y tarjeta. Un caso de uso solo
puede hacerlo desde un worker. Si falla a mitad, su job lo ejecuta otra vez, y cada
paso busca primero lo que dejó una ejecución anterior. De eso va el [capítulo
siguiente](./13-repeatable-workers).

## Inmediato donde importa

No todo lo de un workspace nuevo espera. Quien lo crea tiene que poder entrar en el
momento en que responde la petición, así que `tenant.create` da el acceso de admin en
la propia petición (es el `writesTo: ['access']`, que se explica en [módulos que
hablan](./17-modules-talk)). Si ese segundo guardado fallara, lo termina un worker:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.workers.ts
// Its admin, in case the request that made it stopped before giving it.
tenants.events.created.subscribe(tenant => tenants.ensureAdmin(tenant), {
  strategy: 'handler',
  queue: 'tenant.ensureAdmin.on.tenant.created',
})
```

Esa es la pregunta para cada pieza: ¿lo necesita la persona para seguir, ahora mismo?
El acceso de admin, sí. El tablero de bienvenida puede llegar un instante después.

## Qué ve el cliente, y cómo diseñar para ello

Con consistencia eventual, el cliente recibe un workspace que aún no tiene tablero. El
test de extremo a extremo de cooper lo muestra, a través de la API HTTP de boards:

```ts
// cooper/backend/cooper.test.ts
const created = await call<Workspace>(as, 'POST', '/workspaces', { name: 'Acme' })
expect(created).toMatchObject({ status: 201, body: { name: 'Acme', adminId: id, isAdmin: true } })
const acme = created.body
expect((await call(as, 'GET', '/workspaces')).body).toEqual([acme])
expect((await call(as, 'GET', `/workspaces/${acme.id}/boards`)).body).toMatchObject({ total: 0 })

await settled()
const welcome = await welcomeOf(as, acme.id)
expect(welcome.board.name).toBe('Welcome')
expect(welcome.columns.map(column => column.name)).toEqual(['To do', 'Doing', 'Done'])
```

La API no lo esconde: el workspace está, su admin está, sus tableros todavía no. Quien
construya un cliente sobre ella tiene que contar con ese estado intermedio:

- **Muéstralo tal cual.** Un workspace vacío durante un instante no es un error.
- **Pregunta otra vez** al cabo de un momento, o cuando la persona vuelva a la lista.
  En cooper, el tablero tarda milisegundos.
- **No prometas lo que aún no ha pasado.**

Con el borrado pasa lo mismo, al revés. Cuando se borra un workspace, auth retira los
accesos de sus miembros un instante después, desde un worker. Entre medias, un acceso
sigue apuntando a un workspace que ya no existe, así que el caso de uso que lista los
workspaces de alguien deja esos fuera:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
// A workspace deleted a moment ago, whose accesses auth's worker has not taken away yet, is left out.
return accesses.flatMap(access => {
  const tenant = tenants.get(access.tenantId ?? '')
  return tenant ? [workspaceOf(tenant, userId)] : []
})
```

Cualquier dato que mantenga un worker se comporta así. No es un fallo: es la
consistencia eventual, y tanto la API como sus clientes están diseñados para ella.

## Qué garantiza newt, y qué no

| Garantía | Qué significa |
|---|---|
| El job se guarda con el cambio | Si el workspace existe, su job `workspace.prepare` existe. Nunca uno sin el otro. |
| Se ejecuta tras el commit | Un worker nunca ve un cambio que luego se deshizo. |
| Se repite si falla | Esperando más cada vez, hasta agotar sus intentos (5 por defecto). |
| Sobrevive a los reinicios | Lo pendiente sigue pendiente cuando vuelve el servidor. |
| Al menos una vez | Un job puede ejecutarse **más de una vez**. |

La última fila es la que más trabajo te da, y tiene el capítulo siguiente para ella
sola.

## ¿Y si se para el servidor?

Repasa cada momento del viaje:

- **Se para antes de que auth confirme el workspace.** No hay workspace ni job. El
  cliente recibe un error y lo vuelve a intentar.
- **Se para tras el commit, antes de que corra el worker.** Al volver, el job
  pendiente se ejecuta y el tablero se crea.
- **Se para entre el workspace y su acceso de admin.** `tenant.ensureAdmin` se guardó
  con el workspace, y da el acceso cuando vuelve el servidor.
- **Se para a mitad de `prepare`**, con el tablero creado y una columna. El job no se
  marcó como hecho, así que se ejecuta otra vez, encuentra el tablero y la columna, y
  añade solo lo que falta.

En ningún caso se queda el workspace sin su tablero para siempre. El último caso solo
funciona porque `prepare` está escrito para repetirse sin daño.

## En resumen

- Consistencia eventual: la petición guarda lo que debe y responde; un worker hace el
  resto un instante después.
- Entre contextos es la única forma: cada contexto tiene su store, y ninguna
  transacción abarca dos.
- Da en la petición solo lo que la persona necesita para seguir; lo demás sale de un
  evento.
- La API enseña el estado intermedio tal cual, y el cliente está diseñado para él:
  muéstralo, pregunta otra vez, no prometas.
- newt garantiza que el job se guarda con el cambio y se ejecuta tras el commit, otra
  vez si falla. Se ejecuta al menos una vez, así que quizá más.
