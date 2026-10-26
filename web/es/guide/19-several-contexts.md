# Varios contextos

cooper tiene tres contextos:

- **auth**: quién es cada uno. Cuentas, espacios de trabajo (sus tenants), quién
  puede entrar en qué, y el servidor OAuth con el que entran todas las aplicaciones.
  No usa ningún otro contexto.
- **boards**: el SaaS. Los tableros, columnas y tarjetas de cada espacio, en la web y
  por MCP. Usa auth.
- **backoffice**: la consola del equipo de cooper. Lee auth y boards.

Cada uno es un `BoundedContext` con su store (su propio fichero SQLite), sus módulos
y su servidor, en su puerto. En producción cada uno tiene su dominio, así que sus
cookies también son suyas.

## Quién usa a quién, sin círculos

Los contextos dependen unos de otros como los módulos: nunca en círculo. La
configuración del lint dice quién puede importar a quién, y `bun run lint` falla si
no se cumple:

```js
// eslint.config.js
contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
```

Y `openContexts` los abre en ese orden, cada uno después de los que usa, y le pasa
lo que necesita:

```ts
// cooper/backend/open-contexts.ts
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  // …
  const tracer = config.trace ? new ConsoleTracer() : undefined
  const auth = await Auth_Context.open(config.auth, { mailer }, tracer)
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, log: tracer && (line => console.log(line)) }, tracer)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, tracer)
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}

// …

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
```

El servidor (`index.ts`), el seed y el test de punta a punta abren cooper con esta
misma función. No pueden equivocarse de orden.

## Un solo tracer para todos

Cada contexto se abre con su base, pero todos reciben **el mismo tracer**. Con
`COOPER_TRACE=1`, `openContexts` crea un `ConsoleTracer` y se lo pasa a los tres
(`tracer` en el código de arriba). Los contextos corren en un mismo proceso, así que
un tracer los ve a todos.

Una traza es el caso de uso llamado desde fuera, con todos los casos de uso que llamó
dentro de él, cada uno con el nombre de su contexto y lo que tardó. Un solo tracer da
un solo árbol: cuando un caso de uso de backoffice pide a auth un usuario, el
`user.get` de auth sale sangrado dentro de él, no como una traza aparte. El test del
tracer enseña la forma de lo que escribe:

```ts
// cooper/backend/shared/observability/console-tracer.test.ts
expect(lines.map(line => line.replace(/\d+\.\d ms/, 'n ms'))).toEqual([
  '[trace] backoffice workspace.get n ms',
  '[trace]   backoffice staff.enter n ms (conflict.retry {"attempt":1})',
  '[trace]   broken n ms (error: disk full)',
])
```

```bash
COOPER_TRACE=1 bun run cooper
```

Con las trazas encendidas, boards recibe además un `log`: su módulo `activity`
escribe una línea en la consola cada vez que se mueve una tarjeta.

`ConsoleTracer` es el `Tracer` de newt, la misma interfaz que implementa un adaptador
de OpenTelemetry. Cámbialo y los contextos no cambian
([capítulo 26](./26-production)).

## Un contexto llega a otro solo por sus casos de uso y sus eventos

Nunca por su store. boards nunca lee las tablas de auth, ni sabe que auth funciona
sobre SQLite. De auth recibe dos tipos de cosas:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  auth: Boards_Auth
  mailer: Mailer
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}
```

- **Puertos** (`workspaces`, `tenants`, `access`): lo que necesitan los propios
  módulos de boards, con las palabras de boards ([capítulo 17](./17-modules-talk)).
  Los tests de boards le pasan dobles.
- **Casos de uso de auth** (`auth`): los que boards llama tal cual. Para quién es un
  token de acceso (la sesión web y el servidor MCP), quién es alguien, y lo que
  gestionan las rutas de espacios.

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
export type Boards_Auth = Pick<Auth_Modules, 'token' | 'user' | 'tenant' | 'access' | 'invitation'>
```

A qué producto pertenece un espacio es un nombre que declara auth, junto a sus
productos, y los demás contextos lo importan de ahí:

```ts
// cooper/backend/contexts/auth/modules/product/product.schema.ts
/**
 * The ids of cooper's products, which other contexts name when they ask auth about
 * them: `cooper` (the boards) and `backoffice` (the staff's console).
 */
export const PRODUCTS = { cooper: 'cooper', backoffice: 'backoffice' } as const

/** The product whose workspaces the tenants are: boards, the SaaS. */
export const WORKSPACES_PRODUCT = PRODUCTS.cooper
```

Es una constante, no un módulo: importarla no le da a boards ninguna entrada a los
datos de auth.

`boardsOnAuth` conecta los puertos con auth. Es donde las palabras de boards se
convierten en las de auth: un espacio es un tenant del producto `cooper`, y un
miembro es alguien con acceso a él:

```ts
// cooper/backend/open-contexts.ts
/**
 * What `boards` asks of auth, wired to auth's use cases and events. A workspace is a
 * tenant of the product `cooper`, and its members are those with access to it.
 * boards' reactions to auth's events are subscribed on auth's emitters: they are jobs
 * of auth's outbox, run by auth's worker (`auth.base.jobs.idle()`, then boards').
 */
function boardsOnAuth(auth: Auth_Context): Omit<Boards_ModuleDeps, 'mailer' | 'log'> {
  const { access, user, tenant, token, invitation } = auth.modules
  return {
    workspaces: {
      isMember: async (workspaceId, userId) => (await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) !== null,
      member: async (workspaceId, userId) => {
        if (!await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) return null
        const [found] = await user.getMany([userId])
        return found ? { id: found.id, name: found.name, email: found.email } : null
      },
      // A deleted tenant is not among them.
      exists: async workspaceId => (await tenant.getMany([workspaceId])).length > 0,
    },
    tenants: tenant.events,
    access: access.events,
    auth: { token, user, tenant, access, invitation },
  }
}
```

Los emisores de eventos de auth encajan tal cual en los puertos: un puerto solo pide
`subscribe`. Y cada respuesta del puerto `Workspaces` es una llamada a un caso de uso
de auth: `exists`, que un worker pregunta antes de escribir en un espacio que quizá
ya no está, es `tenant.getMany`, que deja fuera los tenants borrados.

## Llamar a otro contexto es llamar a una API externa

Lo que auth guarda queda guardado, pase lo que pase después en boards. Una
transacción de boards que falle luego no lo deshace. Trata la llamada como tratarías
una llamada a una pasarela de pago:

- **Llámalo después de lo que pueda fallar** en tu lado.
- **Haz que la llamada se pueda repetir.**

Por eso la regla de escritura ([capítulo 17](./17-modules-talk)) **no cruza
contextos**. El caso de uso al que llamas en otro contexto es la **raíz** de lo que
hace allí, como si lo llamara alguien de fuera. La cadena de invocaciones de newt lo
dice así:

```ts
// packages/newt/core/use-case/invocations.ts
// Called from another context, it is that context's API: the root of what it does here.
// Within one, a use case's writesTo counts for what is written below it, however deep.
const root = chain && chain.root.context === link.context
  ? (writesTo.length ? { ...chain.root, writesTo: [...chain.root.writesTo, ...writesTo] } : chain.root)
  : { ...link, writesTo }
```

Dentro de auth, `tenant.create` puede escribir en `tenant` (su módulo) y en `access`
(su `writesTo`), y la regla se cumple como siempre.

## Las rutas de espacios de boards: puertas de entrada a auth

Los espacios, sus miembros y sus invitaciones son de auth. Pero la gente los gestiona
desde la interfaz de boards, en el origen de boards, con la cookie de sesión de
boards. Así que boards tiene rutas para ellos, y **cada ruta llama directamente al
caso de uso de auth**:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
// Workspaces, their members and their invitations are auth's. boards' UI manages them
// through boards' own origin, and these routes call auth's use cases directly: each
// route is an adapter, an entry point like any client's, and what it writes starts
// in auth, under auth's own rules (who is admin, the single admin, the write rule).
// No use case of boards writes in auth: boards only reads it (`mine`, `members`), and
// hears what auth did through its events, from a worker (a new workspace's board).

base.http.get('/workspaces', async () => Response.json(await workspaces.mine()))

base.http.post('/workspaces', async request => {
  const created = await tenant.create(await request.json() as TenantCreateDTO)
  return Response.json(workspaceOf(created, currentActor().userId), { status: 201 })
})

// The rest is about one workspace: a member's (404 for anyone else), and auth checks the admin.
workspace.patch('', async request => {
  const renamed = await tenant.rename(request.params.workspaceId, await request.json() as TenantRenameDTO)
  return Response.json(workspaceOf(renamed, currentActor().userId))
})

// …

// Its admin removes someone, or a member leaves: their cards are unassigned a moment later.
workspace.delete('/members/:userId', async request => {
  await access.revoke({ userId: request.params.userId, productId: WORKSPACES_PRODUCT, tenantId: request.params.workspaceId })
  return noContent()
})
```

Una ruta no es un caso de uso. Es un adaptador, como las rutas de auth. Así que la
cadena empieza en auth: `tenant.create` es su raíz, y las reglas de auth la protegen
(quién es administrador, un solo administrador, la regla de escritura). La petición
corre como la persona que entró en boards, así que para auth `currentActor()` es esa
persona.

¿Por qué no un caso de uso de boards, por ejemplo `workspace.create`, que llame a
`tenant.create`? newt lo permitiría: la llamada sería la raíz en auth. Pero entonces
un caso de uso de boards escribiría en dos stores. Si después de la llamada hiciera
algo en boards y eso fallara, lo de auth se quedaría, y nadie terminaría lo de
boards. cooper sigue una regla más sencilla:

> **Ningún caso de uso de boards escribe en auth.** Los casos de uso de boards solo
> *leen* auth (`workspace.mine`, `workspace.members`). Lo que se escribe en auth
> empieza en una ruta. boards se entera de lo que hizo auth por sus eventos, desde
> un worker.

## Eventos entre contextos

Un espacio nuevo recibe su tablero de bienvenida. auth crea el tenant y publica
`tenant.created`. boards se suscribe a él a través del puerto `TenantEvents`, que es
el emisor de auth:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
export function registerWorkspaceWorkers(workspace: Workspace_Module, deps: Workspace_Deps): void {
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
  deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.purge.on.tenant.deleted',
    // The workspace is gone in auth already: a purge that keeps failing must not die soon.
    attempts: 10,
  })
}
```

¿Dónde corren esos jobs? Una suscripción al emisor de auth es **un job del outbox de
auth**. Se guarda en el store de auth, en la misma transacción que el tenant, y lo
ejecuta **el worker de auth**. El caso de uso al que llama, `workspace.prepare`,
escribe en el store de boards. Puede hacerlo: corre desde un worker, así que la regla
de escritura le deja escribir en `board`, `column` y `card`.

Esto tiene una consecuencia para los tests y los scripts: para esperar a que todo
termine, espera primero a los jobs de auth (entre ellos, las reacciones de boards a
auth) y luego a los de boards (lo que esas reacciones hicieron contar a boards):

```ts
// cooper/backend/cooper.test.ts
/** Until the background work is done: auth's jobs (boards' reactions to auth's events among them), then boards'. */
async function settled() {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}
```

## backoffice

backoffice se abre el último. No recibe los dos contextos que lee, solo sus módulos,
y de esos solo los que usa:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
  boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
}
```

`openContexts` le pasa `auth.modules` y `boards.modules`, y el `Pick` los recorta.
Nunca la base de un contexto, nunca su store: con solo módulos en la mano, backoffice
llega a auth y a boards por sus casos de uso y por nada más. Y la lista dice lo que
toca: backoffice no sabe nada de las columnas de boards, ni de las invitaciones o los
grants OAuth de auth. Si un día necesita `column`, el cambio aparece en este tipo.

Las dos entradas `outbox` son el módulo compartido que cada contexto tiene para sus
jobs muertos: backoffice los lista y los reintenta para el equipo, a través de los
casos de uso de cada contexto.

Sus módulos llegan en el [capítulo 22](./22-backoffice). Siguen las mismas reglas:
leen auth y boards por sus casos de uso, y solo los cambian a través de ellos.

## Cómo comprobarlo

El test de punta a punta de cooper abre los tres contextos como lo hace el servidor,
sobre SQLite en memoria, y usa boards por HTTP como lo haría su interfaz. Crear un
espacio pasa por la ruta de boards hasta auth, y el tablero de bienvenida llega un
momento después:

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
```

Y solo el administrador lo gestiona: la regla de auth responde a través de la ruta de
boards.

```ts
// cooper/backend/cooper.test.ts
expect(await call(bob.as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Mine' })).toMatchObject({ status: 403, body: { code: 'tenant.not_admin' } })
```

```bash
bun test cooper/backend/cooper.test.ts
```

## En resumen

- **Cada contexto tiene su store**, sus módulos y su servidor, en su puerto.
- **Los contextos dependen entre sí sin círculos.** Cada uno se abre después de los
  que usa, y se para antes que ellos. El lint vigila quién importa a quién.
- **Un contexto llega a otro solo por sus casos de uso y sus eventos.** Lo que
  necesita para su propia lógica lo recibe como puertos, con sus palabras. Lo que
  llama tal cual lo recibe como un `Pick` de los módulos del otro: nunca el contexto,
  su base o su store.
- **Un solo tracer para todos los contextos**: una llamada a otro contexto aparece
  dentro del caso de uso que la hizo.
- **Llamar a otro contexto es llamar a una API externa**: después de lo que pueda
  fallar, y que se pueda repetir. El caso de uso llamado es la raíz de lo que hace
  en su contexto.
- **Lo que se escribe en otro contexto empieza en una ruta**, una puerta de entrada.
  Ningún caso de uso tuyo escribe en otro contexto. Las reacciones van por eventos y
  workers.
- Una suscripción al emisor de otro contexto es **un job del outbox de ese
  contexto**, y la ejecuta su worker. Espera primero a sus jobs.
