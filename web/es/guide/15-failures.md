# Cuando algo falla

Un worker llama a un caso de uso, y el caso de uso lanza un error: el servidor de
correo no responde, la base de datos está bloqueada, un bug. Este capítulo enseña qué
hace newt entonces: cómo reintenta, cuándo se rinde, qué es un job muerto y cómo
recuperarlo. Y qué no es un fallo en absoluto.

## Reintentos, esperando más cada vez

Si el caso de uso al que llama un `'handler'` lanza un error, su job vuelve a la cola
y se ejecuta otra vez más tarde. Cada vez espera el doble: 10 segundos, 20, 40, 80…
hasta 15 minutos entre una ejecución y la siguiente. Estos son los valores por
defecto del worker:

```ts
// packages/newt/runtime/jobs/job-queue.ts
const DEFAULTS: JobQueueOptions = {
  concurrency: 10,
  pollMs: 5_000,
  leaseMs: 60_000,
  backoffMs: 10_000,
  maxBackoffMs: 15 * 60_000,
  keepDoneMs: 7 * 24 * 60 * 60_000,
  seenEveryMs: 60_000,
}

const DEFAULT_ATTEMPTS = 5
```

```ts
// packages/newt/runtime/jobs/job-queue.ts
private backoff(attempts: number): number {
  return Math.min(this.options.backoffMs * 2 ** (attempts - 1), this.options.maxBackoffMs)
}
```

Por defecto un job tiene 5 intentos. Uno que falla siempre espera 10 + 20 + 40 + 80
segundos entre ellos, y muere unos dos minutos y medio después de su primer fallo. Una
caída corta del servidor de correo ya lo mata.

Para un job que tiene que aguantar más, sube sus `attempts`. cooper lo hace con uno:
el paso del borrado de un workspace que limpia boards:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
  strategy: 'handler',
  queue: 'workspace.purge.on.tenant.deleted',
  // The workspace is gone in auth already: a purge that keeps failing must not die soon.
  attempts: 10,
})
```

Con 10 intentos las esperas son 10 s, 20 s, 40 s, 80 s, 160 s, 320 s, 640 s y después
15 minutos dos veces: sigue intentándolo unos 50 minutos. El motivo está en el
comentario. Cuando corre este job, el workspace ya no existe en auth. Si muere, boards
se queda con filas de un workspace que nadie puede ver, y nada más las borrará nunca.

Para todo un contexto, la base recibe las opciones del worker, entre ellas
`jobs.backoffMs` y `jobs.maxBackoffMs`:

```ts
// packages/newt/runtime/base-options.ts
/** How its worker runs the jobs of `handler` subscriptions. */
jobs?: Partial<JobQueueOptions>
```

cooper se queda con los valores por defecto.

## Un worker que muere a mitad de un job

Mientras se ejecuta, un job es de su worker durante una concesión (lease) de un
minuto, que el worker renueva cada veinte segundos. Si el worker muere (matan el
proceso, se apaga la máquina), nadie la renueva. Un minuto después el job queda
libre, y otro worker, o el mismo proceso cuando vuelva, se lo queda.

Cada vez que se reclama cuenta como un intento. Un job cuyo worker murió en todos los
intentos que tenía no se vuelve a ejecutar: muere, con un mensaje que dice por qué.

```ts
// packages/newt/runtime/jobs/job-queue.ts
// Its worker stopped mid-run on every attempt it had: running it again would not help.
if (claimed.attempts > registration.attempts) return this.close(claimed, { status: 'dead', lastError: claimed.lastError ?? 'Its worker stopped before it finished, on every attempt' })
```

## Jobs muertos

Un job que agota sus intentos queda **muerto** (`dead`), con su último error apuntado.
No se borra: alguien tiene que mirarlo.

```ts
// packages/newt/runtime/jobs/job-queue.ts
try {
  await detached(() => inWorker.run(true, () => registration.handler(JSON.parse(claimed.event) as DomainEvent)))
  await this.close(claimed, { status: 'done', lastError: null })
} catch (error) {
  const lastError = error instanceof Error ? error.stack ?? error.message : String(error)
  await (claimed.attempts >= registration.attempts
    ? this.close(claimed, { status: 'dead', lastError })
    : this.close(claimed, { status: 'pending', lastError, runAfter: this.later(this.backoff(claimed.attempts)) }))
}
```

Los jobs terminados son historia: se guardan una semana y después se borran. Los
muertos se quedan hasta que alguien se ocupe de ellos.

El outbox del store te da lo que necesitas para cuidarlos:

```ts
// packages/newt/port-outbox/outbox.ts
/**
 * Puts a dead job back to wait, as new: no attempts, due now. For whoever fixed
 * what killed it. Whether it was dead and is now waiting: a job in any other state,
 * or none with that id, is left as it is.
 */
retry(id: string): Promise<boolean>
// …
/** Every job it keeps, oldest first: for whoever looks after them (an admin page, a test). */
list(): Promise<Job[]>
```

Cada job dice su `queue`, su `status` (`pending`, `running`, `done` o `dead`),
cuántos `attempts` hizo, su `lastError` y el `event` al que reacciona, como JSON.

### Un módulo sobre el outbox de cada contexto

El outbox es del store de un contexto, y ningún otro contexto mete la mano en ese
store. Así que cooper pone encima un módulo pequeño, compartido por todos los
contextos: cada contexto inicializa el suyo, sobre su propio outbox, y lo ofrece como
cualquier otro módulo.

```ts
// cooper/backend/shared/outbox/outbox.module.ts
export class Outbox_Module extends Module {

  static initialize(base: CooperBase): Outbox_Module {
    return new Outbox_Module(base)
  }

  // …
  @UseCase()
  async dead(page: PageRequest): Promise<Page<DeadJobDTO>> {
    const dead = (await this.base.store.outbox.list())
      .filter(job => job.status === 'dead')
      .toSorted((a, b) => (a.id < b.id ? 1 : -1))
    const after = page.cursor ? dead.filter(job => job.id < page.cursor!) : dead
    return { items: after.slice(0, page.size).map(toDTO), hasMore: after.length > page.size, total: dead.length }
  }

  /**
   * Puts a dead job back to wait, as new: its worker runs it again at once, with all its
   * attempts. A plain use case: it writes no module's rows through a repository, which
   * is what the write rule watches, but the store's outbox, in one step.
   */
  @UseCase()
  async retry(id: string): Promise<void> {
    if (await this.base.store.outbox.retry(id)) return
    const job = (await this.base.store.outbox.list()).find(each => each.id === id)
    throw job ? new JobNotDead(id, job.status) : new JobNotFound(id)
  }
}
```

Un job muerto deja fuera el payload de su evento: el equipo ve la cola, el nombre del
evento, los intentos y el último error. Con eso sabe qué falló, y no ve más de lo que
necesita.

```ts
// cooper/backend/shared/outbox/outbox.schema.ts
export type DeadJobDTO = {
  id: string
  queue: string
  /** The event's name: `card.assigned`. */
  event: string
  attempts: number
  lastError: string | null
  createdAt: string
  /** When it died. */
  updatedAt: string
}
```

### La página Jobs del equipo

El backoffice del equipo tiene una página Jobs: una pestaña por contexto, los jobs
muertos de cada uno con su error, y un botón para reintentar uno. Su módulo `job` le
pregunta al módulo de outbox de cada contexto, a través de sus casos de uso, nunca de
su base ni de su store:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
const job = Job_Module.initialize(base, { staff, outboxes: { auth: auth.outbox, boards: boards.outbox, backoffice: outbox } })
```

```ts
// cooper/backend/contexts/backoffice/modules/job/job.module.ts
/** A page of a context's dead jobs, the newest first. */
@UseCase()
async dead(context: JobContext, page: PageRequest): Promise<Page<ContextJobDTO>> {
  const name = JobContextSchema.parse(context)
  const found = await this.deps.outboxes[name].dead(page)
  return { ...found, items: found.items.map(job => ({ ...job, context: name })) }
}

/**
 * A dead job of a context runs again: what a person of the staff asks for, at once,
 * once they fixed what killed it. The context's own use case puts it back; its
 * worker runs it. No `writesTo`, not even for the backoffice's own outbox: the
 * write rule watches what repositories save, and a job put back is the store's
 * outbox, written by `outbox.retry` in one step.
 */
@UseCase()
async retry(context: JobContext, id: string): Promise<void> {
  await this.deps.outboxes[JobContextSchema.parse(context)].retry(id)
}
```

`retry` llama al `outbox.retry` de cada contexto desde una petición, y no declara
`writesTo`. La regla de escritura ([módulos que hablan](./17-modules-talk)) vigila las
filas que un caso de uso guarda con repositorios, y devolver un job no guarda
ninguna: es una sola escritura en el outbox del store, la misma tabla en la que murió
el job. Lo pide una persona del equipo, que espera la respuesta, así que no puede
esperar a un worker. Dos rutas, tras la comprobación
del equipo, son la API a la que llama la página:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.routes.ts
// `/jobs/boards`: boards' dead jobs. A context that is not one is a 400.
routes.get('/jobs/:context', async request =>
  Response.json(await jobs.dead(request.params.context as JobContext, pageRequestFrom(request))))

routes.post('/jobs/:context/:jobId/retry', async request => {
  await jobs.retry(request.params.context as JobContext, request.params.jobId)
  return new Response(null, { status: 204 })
})
```

```http
GET /api/jobs/boards
POST /api/jobs/boards/<id del job>/retry
```

El ciclo entero está en un test: una reacción falla mientras "el servidor de correo
está caído", muere en su único intento, aparece en la lista de boards con su error,
se reintenta cuando el servidor vuelve, y acaba `done`. Un job hecho no se puede
reintentar:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.test.ts
let down = true
t.boards.modules.card.events.created.subscribe(() => {
  if (down) throw new Error('the mail server is down')
// eslint-disable-next-line newt/queue-name
}, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
await t.board(sam, tenant.id, 'Roadmap', ['One'])
await t.settled()

const dead = await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))
expect(dead.items).toEqual([expect.objectContaining({
  context: 'boards',
  queue: 'test.tellSomeone.on.card.created',
  event: 'card.created',
  attempts: 1,
  lastError: expect.stringContaining('the mail server is down'),
})])
// …
down = false
await t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))
await t.settled()

expect((await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))).total).toBe(0)
// …
// Done is done: it is not run again.
await expect(t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))).rejects.toMatchObject({ code: 'outbox.job_not_dead', status: 409 })
```

Los tests también leen el outbox directamente, para comprobar que todos los jobs
terminaron. El auth falso de boards entrega sus jobs:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
/** The jobs of its events, as they stand: to see one that failed. */
jobs() {
  return this.base.store.outbox.list()
}
```

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
// Each deletion is heard twice: the workspace's purge, and its activity's.
expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
```

Un job muerto no es una línea más de log. Significa algo concreto: una reacción que
no ocurrió. Un tablero de bienvenida que no se creó, un email que no salió, un
workspace cuyos tableros no se borraron. La salida es siempre la misma: busca en
`lastError` qué lo mató, arregla la causa y reinténtalo. El job se ejecuta otra vez
desde cero, y es seguro porque es [idempotente](./13-repeatable-workers).

## La forma de un evento solo crece

Un job guarda su evento tal como se publicó, y puede ejecutarse después de un
despliegue, con el código nuevo. Así que el caso de uso que lo ejecuta tiene que
entender eventos escritos por el código viejo:

> La forma de un evento solo crece: puedes añadirle campos opcionales, pero nunca
> quitar uno, renombrarlo ni cambiar lo que significa.

`card.assigned` lleva `{ dto, previousAssigneeId, by, via, eventId, at }`. Puedes
añadir un campo, si el código que lo lee aguanta que falte: un job guardado antes del
despliegue no lo tiene. No puedes renombrar `previousAssigneeId`: los
jobs pendientes en el momento del despliegue llevarían el nombre viejo. Si de verdad
necesitas romper la forma, el mismo despliegue trae una migración que reescribe los
jobs pendientes de ese evento.

Con los nombres de las colas pasa lo mismo: el [capítulo de
reaccionar](./11-reacting) enseñó qué les pasa a los jobs de una cola renombrada.

## Lo que no es un error

No todo lo que no sigue adelante es un fallo. Mira cómo terminan los workers de cooper
cuando no hay nada que hacer:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.module.ts
const invitation = await this.repo.first({ id: invitationId })
if (!invitation?.isOpen()) return
const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
if (!tenant) return
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
if (!member) return
```

Una invitación revocada antes de que saliera su email, un workspace borrado entre
medias, una persona asignada que se fue: nada de eso es un fallo del sistema. Son
respuestas. El job hizo su trabajo, que era descubrir que no hay nada que hacer, y
termina `done`.

Si `send` lanzara `InvitationNotOpen`, el job se ejecutaría cinco veces para obtener
cinco veces la misma respuesta, y después moriría, y alguien tendría que mirar un job
muerto que no significa nada. Así que:

- **Haz return** cuando el mundo dice que no hay nada que hacer: un "no" de negocio.
- **Lanza el error** cuando algo falló y reintentarlo más tarde podría funcionar: el
  servidor de correo, la base de datos, un bug que arreglarás. No los captures en el
  worker: deja que newt reintente.

Por eso un worker usa `first` y hace return, donde un caso de uso que llama una
persona usa `resolve` y lanza `CardNotFound`: la persona necesita el 404; el worker
no.

## En resumen

- Un job que falla se repite: 5 intentos por defecto, esperando 10 s, 20 s, 40 s…
  hasta 15 minutos. Sube `attempts` para lo que no debe morir pronto.
- Un job es de su worker durante una concesión de un minuto, renovada mientras se
  ejecuta. Los jobs de un worker muerto los recoge otro un minuto después.
- Un job sin intentos queda muerto, con su último error. Los muertos se quedan hasta
  que alguien arregla la causa y llama a `outbox.retry(id)`.
- Un job muerto es una reacción que no ocurrió. Dale a quien lleva la aplicación un
  sitio donde verlos y reintentarlos: en cooper, la página Jobs del backoffice, sobre
  un módulo de outbox por contexto.
- La forma de un evento solo crece: los jobs pendientes llevan la vieja.
- Haz return ante un "no" de negocio; lanza el error ante un fallo, y deja que newt
  lo reintente.
