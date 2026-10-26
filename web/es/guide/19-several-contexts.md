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
  const auth = await Auth_Context.open(config.auth, { mailer })
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer })
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth, boards })
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

`boardsOnAuth` conecta los puertos con auth. Es el único sitio que sabe que un
espacio es un tenant del producto `cooper`, y que un miembro es alguien con acceso a
él:

```ts
// cooper/backend/open-contexts.ts
/**
 * What `boards` asks of auth, wired to auth's use cases and events. A workspace is a
 * tenant of the product `cooper`, and its members are those with access to it.
 * boards' reactions to auth's events are subscribed on auth's emitters: they are jobs
 * of auth's outbox, run by auth's worker (`auth.base.jobs.idle()`, then boards').
 */
function boardsOnAuth(auth: Auth_Context): Omit<Boards_ModuleDeps, 'mailer'> {
  const { access, user, tenant, token, invitation } = auth.modules
  return {
    workspaces: {
      isMember: async (workspaceId, userId) => (await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) !== null,
      member: async (workspaceId, userId) => {
        if (!await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) return null
        const [found] = await user.getMany([userId])
        return found ? { id: found.id, name: found.name, email: found.email } : null
      },
    },
    tenants: tenant.events,
    access: access.events,
    auth: { token, user, tenant, access, invitation },
  }
}
```

Los emisores de eventos de auth encajan tal cual en los puertos: un puerto solo pide
`subscribe`.

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

backoffice se abre el último, y recibe los dos contextos que lee:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
/** What `backoffice`'s modules are given besides its base: the contexts it reads. */
export type Backoffice_ModuleDeps = {
  auth: Auth_Context
  boards: Boards_Context
}
```

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
  necesita para su propia lógica lo recibe como puertos, con sus palabras.
- **Llamar a otro contexto es llamar a una API externa**: después de lo que pueda
  fallar, y que se pueda repetir. El caso de uso llamado es la raíz de lo que hace
  en su contexto.
- **Lo que se escribe en otro contexto empieza en una ruta**, una puerta de entrada.
  Ningún caso de uso tuyo escribe en otro contexto. Las reacciones van por eventos y
  workers.
- Una suscripción al emisor de otro contexto es **un job del outbox de ese
  contexto**, y la ejecuta su worker. Espera primero a sus jobs.
