# Lo que no se puede deshacer, y los fallos

Ana asigna la tarjeta #1 a carl. carl debería enterarse: un email, "#1 Plan is yours",
con un enlace a la tarjeta.

¿Desde dónde sale el email? El sitio obvio es `card.assign`, justo después del guardado.
Es el sitio equivocado. El capítulo [8](./08-two-people-one-card) explicó por qué: un
caso de uso puede ejecutarse otra vez ante un conflicto, desde el principio, y uno que
enviara un email antes de guardar lo enviaría dos veces. Después del guardado no es más
seguro: un caso de uso al que llama otro se ejecuta otra vez cada vez que choca su
llamador, y envía de nuevo cada vez; y un caso de uso que falla después de su guardado ha
avisado a carl de algo que su llamador quizá nunca muestre. Una escritura en la base de
datos se puede deshacer. **Un email no se puede retirar.**

La respuesta es la del [capítulo anterior](./11-reacting): un `handler` en
`card.assigned`. Su job se guarda con la asignación, así que el email sale solo para una
asignación que se guardó, una vez guardada. Este capítulo lo escribe, con un mailer que
entrega la aplicación, y luego mira qué pasa cuando un job sigue fallando: el servidor de
correo está caído, el job se queda sin intentos, y alguien tiene que volver a ponerlo en
cola.

## El mailer: un puerto de la aplicación

El módulo de tarjetas no debería saber cómo se envía un email: SMTP, una API de email, la
consola. Necesita una sola cosa, "envía este email", con sus propias palabras. Eso es un
puerto, como el puerto `Workspaces` del capítulo [4](./04-who-and-where). Pero este no es
solo de boards: auth también envía emails, más adelante. Así que vive en `shared/`, como
puerto de la aplicación:

```ts
// cooper/backend/shared/mail/mailer.ts
import type { Email } from 'newt/core'

/** One email: plain text, which every reader shows. */
export type Mail = {
  to: Email
  subject: string
  text: string
  /**
   * The same email sent again has the same key, and is sent once: what a worker gives
   * when its job may run twice (the id of the event it tells of). A mailer of a real
   * provider must honour it, passing it as the provider's idempotency key (most take
   * one, as a header). None: each send is a new email.
   */
  key?: string
}

/**
 * Whatever sends an email: the console in development, a list in a test, an SMTP
 * server or an email API in production. A module sends one only from a worker, once
 * what it tells is saved: an email cannot be taken back. An email with a `key`
 * already sent is not sent again.
 */
export type Mailer = {
  send(mail: Mail): Promise<void>
}
```

- `Mail` es texto plano, que muestra cualquier lector. `to` es el `Email` de newt
  (sin espacios sobrantes, en minúsculas), el tipo que ya tiene el email de un miembro.
- `key` es opcional. Dos emails con la misma clave son un solo email: el segundo no se
  envía. Para qué la necesita un worker lo cuenta [Ejecutado dos veces, enviado una
  vez](#ejecutado-dos-veces-enviado-una-vez), más abajo.
- `Mailer` es un tipo con un método. Todo lo que lo tenga es un mailer.

Su comentario dice la regla que lo acompaña: un módulo envía un email solo desde un
worker, una vez guardado lo que cuenta. Y la promesa que hace todo mailer: un email cuya
clave ya se envió no se envía otra vez.

El primer adaptador escribe cada email en la consola, para desarrollo:

```ts
// cooper/backend/shared/mail/console-mailer.ts
import type { Mail, Mailer } from './mailer'

/**
 * A mailer that writes each email to the console instead of sending it: cooper's, in
 * development. It remembers the keys it wrote while the process runs: an email with
 * one of them is not written again.
 */
export class ConsoleMailer implements Mailer {

  private readonly sent = new Set<string>()

  constructor(private readonly from: string) {}

  async send(mail: Mail): Promise<void> {
    if (mail.key !== undefined) {
      if (this.sent.has(mail.key)) return
      this.sent.add(mail.key)
    }
    console.log([`[mail] from ${this.from} to ${mail.to}: ${mail.subject}`, ...mail.text.split('\n').map(line => `  ${line}`)].join('\n'))
  }
}
```

Cumple su promesa de la forma más sencilla: un conjunto de las claves que escribió, en
memoria. Basta para desarrollo, donde un reinicio las olvida y a nadie le importa. Un
test recibe otro, una lista (más abajo). Producción recibe uno que habla con un servicio
de correo real y le pasa la clave; el módulo no cambia.

## Adónde escribir: el email del miembro

Para enviar un email a carl el módulo de tarjetas necesita su dirección y su nombre.
boards no guarda personas: las guarda auth, y boards pregunta a través del puerto
`Workspaces`. Ese solo sabe responder si alguien es miembro. Añade un método que dé al
miembro, después de `isMember`:

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
import type { MemberDTO } from './member.schema'
// …
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
}
```

`MemberDTO` está en `member.schema.ts` desde el capítulo [4](./04-who-and-where): un id,
un nombre y un email. El auth falso lo responde con lo que guarda:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
    member: async (workspaceId, userId) => this.members.get(workspaceId)?.get(userId) ?? null,
```

El módulo de miembros lo ofrece como caso de uso, `find`, después de `isMember`.
Importa también `MemberDTO`:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
import type { MemberDTO } from './member.schema'
// …
  /** Someone of a workspace, or null if they do not belong to it (any more): what a worker, outside any scope, asks. */
  @UseCase()
  async find(workspaceId: string, userId: string): Promise<MemberDTO | null> {
    return this.deps.workspaces.member(workspaceId, userId)
  }
```

`isMember` lee el workspace del scope; `find` lo recibe como argumento. Uno es para las
peticiones, que entraron en un workspace; el otro para los workers, que no están en
ninguno.

Las deps del módulo de tarjetas dicen ahora lo que pide al módulo de miembros:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
```

## Las opciones de las tarjetas

El módulo de tarjetas recibe el mailer en `initialize`, como opción, y dónde abre la
gente los tableros, para el enlace del email:

```ts
// cooper/backend/contexts/boards/modules/card/card-options.ts
import type { Mailer } from '../../../../shared/mail/mailer'

/** What the context configures the cards with. */
export type Card_Options = {
  /** What tells an assignee: the console in development, a list in a test. */
  mailer: Mailer
  /** Where people open boards: the links of its emails start there. */
  publicUrl: string
}
```

Ambos vienen del contexto. `publicUrl` es un ajuste, así que va en `config.ts`, junto
con quién envía los emails. Este es el archivo entero ahora:

```ts
// cooper/backend/config.ts
import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

const env = process.env

/**
 * `COOPER_<CONTEXT>_PUBLIC_URL`: where people open each context. In development it is
 * its frontend's Vite server, which sends the API's addresses on to the context's port;
 * in production, the context's own domain, in front of its port.
 */
const publicUrls = {
  boards: env.COOPER_BOARDS_PUBLIC_URL ?? 'http://localhost:5172',
}

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens, where its database lives and
 * where people open it.
 */
export const config = {
  /** `COOPER_MAIL_FROM`: who the emails come from, whichever context sends them. */
  mail: {
    from: env.COOPER_MAIL_FROM ?? 'cooper <no-reply@cooper.local>',
  },
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
    publicUrl: publicUrls.boards,
  },
}

export type Config = typeof config
```

- `COOPER_MAIL_FROM` es uno para toda la aplicación: los emails de todos los contextos
  salen de la misma dirección.
- `COOPER_BOARDS_PUBLIC_URL` es donde la gente abre boards. En desarrollo, el frontend de
  boards (capítulo [23](./23-frontends)) corre en el puerto 5172; en producción, el
  dominio propio de boards. Un enlace de un email se envía una vez y no se puede corregir
  después, así que se construye con este ajuste, nunca con el sitio desde el que entró
  una petición.

`Boards_Config` es `Config['boards']`, así que el contexto recibe `publicUrl` sin ningún
otro cambio.

El mailer no es un ajuste: es algo que se entrega al contexto, como el puerto
`Workspaces`. En `initialize-modules.ts` se une a `Boards_ModuleDeps`, y las tarjetas
reciben sus opciones. El archivo también inicializa el módulo del outbox, que viene más
abajo; aquí está entero:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace), and a mailer. Whoever opens the
 * context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  mailer: Mailer
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  const activity = Activity_Module.initialize(base, { card, member }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { member, board, column, card, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

## El caso de uso que lo envía

En `card.module.ts`, `initialize` recibe las opciones, las guarda, y registra las
reacciones del módulo (el archivo de la sección siguiente):

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  static initialize(base: BoardsBase, deps: Card_Deps, options: Card_Options): Card_Module {
    const module = new Card_Module(base, new Card_Repository(base), deps, options)
    registerCardRoutes(base, module, deps)
    registerCardWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(
    base: BoardsBase,
    private readonly repo: Card_Repository,
    private readonly deps: Card_Deps,
    private readonly options: Card_Options,
  ) {
```

con tres imports más:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
// …
import type { Card_Deps } from './card.deps'
import type { Card_Options } from './card-options'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { registerCardWorkers } from './card.workers'
```

Y el caso de uso al que llama un worker, después de `removeColumn`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Tells the assignee of a card they have it, by email: from a worker, once the
   * assignment is saved, since an email cannot be taken back. Run late, it
   * reads the card again: if it is gone, or has another assignee by then, there is
   * nothing to tell (that assignment tells its own). Nor is anyone told of a card
   * they gave themselves (`by`, who created or assigned it). Its job may run twice:
   * the email's key is the event's id (`eventId`), so it is sent once.
   */
  @UseCase()
  async notifyAssignee(card: CardDTO, by: string | null, eventId: string): Promise<void> {
    if (card.assigneeId === null || card.assigneeId === by) return
    const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
    if (current?.assigneeId !== card.assigneeId) return
    const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
    if (!member) return
    // Where boards' UI opens the card: on its board's screen, by its id.
    const link = new URL(`/w/${card.workspaceId}/boards/${card.boardId}?card=${card.id}`, this.options.publicUrl)
    await this.options.mailer.send({
      to: member.email,
      subject: `#${card.number} ${card.title} is yours`,
      text: [`Hi ${member.name},`, '', `Card #${card.number}, "${card.title}", is assigned to you.`, '', link.toString()].join('\n'),
      key: `card.notifyAssignee:${eventId}`,
    })
  }
```

Léelo como la lista de razones para **no** enviar:

1. **Nadie a quien avisar, o lo hizo él mismo.** Una tarjeta sin asignado, o una que ana
   se dio a sí misma: `by` es quien actuó, sacado del evento, porque un worker no tiene
   actor.
2. **Ya no es verdad.** Un job se ejecuta un momento después de su guardado, o minutos
   después, si falló antes. Para entonces la tarjeta puede estar borrada, o asignada a
   otra persona. Así que **lee la tarjeta otra vez**, en su workspace, y no envía nada si
   el asignado no es el que contó el evento. Si ana dio la tarjeta a bea y se la quitó un
   segundo después, bea no oye nada; si se la dio a carl en su lugar, el `card.assigned`
   de carl le avisa a él.
3. **Se fue.** El miembro ya no está en el workspace: `find` dice null.

Solo entonces construye el enlace y envía, con una clave. El caso de uso `assign` no
sabe nada de emails; este no sabe nada de asignar.

### Ejecutado dos veces, enviado una vez

El [capítulo anterior](./11-reacting) hizo idempotente cada handler, con clave en el id de
su evento. Un email es el caso en el que la base de datos de cooper no puede hacerlo
sola. Si el proceso se detiene después de que el mailer envió y antes de que el job se
marque como hecho, el job se ejecuta otra vez, desde el principio: lee la tarjeta,
encuentra que carl sigue siendo su asignado, y envía. Lo mismo ocurre si el job falla en
cualquier cosa posterior al envío, o si su worker pierde el lease en mitad del envío.
Nada de lo que escribe cooper puede impedirlo: el envío está fuera de su base de datos, y
ninguna transacción abarca las dos cosas.

Así que la otra parte tiene que ayudar. El job de un evento es el mismo job cada vez que
se ejecuta, y su evento tiene el mismo id cada vez: ese id es la **clave** del email,
`card.notifyAssignee:<id del evento>`. La primera ejecución envía el email con esa
clave; una segunda lo envía otra vez con la misma clave, y el mailer lo descarta. Otra
asignación es otro evento, otro id, otro email: si la tarjeta se da a carl, luego a bea,
y luego otra vez a carl, carl se entera dos veces, como debe.

Eso lleva la garantía al mailer, y todo mailer tiene que cumplirla:

- `ConsoleMailer` y el mailer de los tests recuerdan las claves que han visto.
- El mailer de un proveedor real pasa la clave como la **clave de idempotencia** del
  proveedor. La mayoría de las APIs de email aceptan una, como cabecera, y envían un
  email por clave, por muchas peticiones que la lleven. Un mailer que descartara la
  clave dejaría pasar el duplicado, y nada en boards lo notaría.

El prefijo, `card.notifyAssignee:`, separa las claves de reacciones distintas: otro
worker del mismo evento, que enviara otro email, pondría su propio nombre. Y leer la
tarjeta otra vez sigue importando: la clave impide el mismo email dos veces, no un email
que ya no es verdad.

## La reacción, y `when`

El módulo de tarjetas reacciona a sus propios eventos. Las reacciones de un módulo van en
`<módulo>.workers.ts`, como las de la actividad:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

/**
 * What the cards do when something happens, each a job saved with what it reacts to,
 * run by a worker until it succeeds, and safe to run again.
 */
export function registerCardWorkers(cards: Card_Module, deps: Card_Deps): void {
  // An assignee hears of it once it is saved: a card created for someone, or given to them, by someone else.
  cards.events.created.subscribe(({ by, ...card }, { id }) => cards.notifyAssignee(card, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.created',
    when: card => card.assigneeId !== null,
  })
  cards.events.assigned.subscribe(({ dto, by }, { id }) => cards.notifyAssignee(dto, by, id), {
    strategy: 'handler',
    queue: 'card.notifyAssignee.on.card.assigned',
  })
}
```

Dos colas para un caso de uso: un asignado se entera de una tarjeta **creada** para él, y
de una **asignada** a él. Cada una es su propia cola, con el nombre del evento que oye.

Un handler recibe un segundo argumento además del payload: el `EventMeta` del evento
(capítulo [11](./11-reacting)). Su `id` es el del evento, el mismo en cada ejecución del
job, y pasa a ser el `eventId` de `notifyAssignee`, la clave del email.

`registerCardWorkers` recibe las deps del módulo y aún no las usa: el capítulo
[13](./13-another-context) añade reacciones a los eventos de las columnas y a los de
auth.

`card.created` viene con **`when`**. La mayoría de las tarjetas se crean sin nadie
asignado, y esas no necesitan email. `when` mira el payload y dice si esta suscripción
toma el evento o no:

- Se ejecuta en la transacción del guardado que cuenta el evento, **antes de escribir
  ningún job**. Una tarjeta creada sin asignado no deja ningún job en
  `card.notifyAssignee.on.card.created`: nada que reclamar, nada que ejecutar, nada que
  purgar.
- Solo mira el payload. No es lógica de negocio: si el asignado debe enterarse lo dice
  `notifyAssignee`. `when` dice qué eventos conciernen a la reacción en absoluto.
- Con un type guard, con su parámetro tipado, estrecha lo que recibe el callback. El
  capítulo [13](./13-another-context) lo usa.

`card.assigned` no tiene `when`: una asignación siempre tiene un asignado.

## Cuando un job falla

Un handler que lanza un error ha fallado, y newt ejecuta su job otra vez. No de
inmediato: el servidor de correo que estaba caído hace un segundo probablemente sigue
caído. Cada ejecución es un **intento**, y tras cada intento fallido el job espera, el
doble cada vez, el **backoff**:

| Tras el intento | Espera |
|---|---|
| 1 | 10 segundos |
| 2 | 20 segundos |
| 3 | 40 segundos |
| 4 | 80 segundos |
| … | se duplica, hasta 15 minutos |

Una suscripción tiene **5 intentos** salvo que diga otra cosa, con `attempts`. Con el
valor por defecto, un job que siempre falla se ejecuta cinco veces en unos dos minutos y
medio. Un job que debe sobrevivir a una caída más larga pide más: el capítulo
[14](./14-sagas) da uno de diez.

Las esperas son del contexto: `Base` recibe `jobs: { backoffMs, maxBackoffMs }` (10
segundos y 15 minutos por defecto), junto con los demás ajustes del worker. cooper
mantiene los valores por defecto de newt.

Mientras un job se ejecuta pertenece a su worker por un lease de un minuto, que el worker
renueva mientras el handler se ejecuta. Un worker que muere a mitad de un job (el proceso
se mata) deja de renovarlo, y un minuto después otro worker, o el mismo servidor cuando
vuelve, toma el job. Esa reclamación cuenta también como intento: un job cuyo worker
murió en cada intento no se ejecuta más.

### Jobs muertos

Un job que se queda sin intentos está **muerto**. newt lo guarda con su último error y
deja de ejecutarlo. No ocurre nada más por sí solo: un email que nunca se envió, un paso
de un flujo que nunca se ejecutó. **Alguien tiene que mirar**: averiguar qué lo mató,
arreglarlo, y volver a poner el job en cola.

El store da lo que hace falta para eso. Cada store guarda sus jobs en su propio
**`Outbox`**, el puerto de newt para ellos (`newt/port-outbox`), en `base.store.outbox`.
Tres de sus métodos son para quien cuida de los jobs:

- `list(query?)`: los jobs que guarda, del más antiguo al más nuevo; `{ status: 'dead' }`
  para los muertos.
- `get(id)`: un job.
- `retry(id)`: devuelve un job muerto a la espera, como nuevo: sin intentos, listo ya.
  Dice si lo hizo: un job en cualquier otro estado se deja como está.

Cada job dice su `queue`, su `status` (`pending`, `running`, `done` o `dead`), sus
`attempts`, su `lastError` y su `event`, como el JSON con el que se contó.

### Un módulo outbox para cada contexto

Ningún módulo llega al store: los módulos usan repositorios, y el store de un contexto es
suyo. Así que cooper pone un pequeño módulo sobre el outbox de cada contexto, compartido
por todos los contextos: cada uno inicializa el suyo, sobre su propio store. Tiene dos
errores:

```ts
// cooper/backend/shared/outbox/errors/job-not-found.ts
import { NotFoundError } from 'newt/core'

export class JobNotFound extends NotFoundError {
  readonly code = 'outbox.job_not_found'
  constructor(id: string) {
    super(`There is no job ${id}`)
  }
}
```

```ts
// cooper/backend/shared/outbox/errors/job-not-dead.ts
import { ConflictError } from 'newt/core'

/** Only a dead job is retried: one waiting or running is on its way, one done is done. */
export class JobNotDead extends ConflictError {
  readonly code = 'outbox.job_not_dead'
  constructor(id: string, status: string) {
    super(`Job ${id} is ${status}, not dead: only a dead job is retried`)
  }
}
```

lo que muestra de un job muerto:

```ts
// cooper/backend/shared/outbox/outbox.schema.ts
/**
 * A job that ran out of attempts, as whoever looks after a context's jobs sees it: the
 * reaction it was (`queue`), to which event, how many times it ran and why it failed
 * the last time. Its event's payload stays out: it may say more than the staff need.
 */
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

y el módulo:

```ts
// cooper/backend/shared/outbox/outbox.module.ts
import { Module, toPage, UseCase, type Page, type PageRequest } from 'newt/core'
import type { Job } from 'newt/port-outbox'
import type { CooperBase } from '../cooper-base'
import { JobNotDead } from './errors/job-not-dead'
import { JobNotFound } from './errors/job-not-found'
import type { DeadJobDTO } from './outbox.schema'

/** The event's name, from the job's copy of it. */
function eventName(job: Job): string {
  try {
    return String((JSON.parse(job.event) as { name?: unknown }).name ?? '')
  } catch {
    return ''
  }
}

function toDTO(job: Job): DeadJobDTO {
  const { id, queue, attempts, lastError, createdAt, updatedAt } = job
  return { id, queue, event: eventName(job), attempts, lastError, createdAt, updatedAt }
}

/**
 * A context's own jobs, for whoever looks after them: those that ran out of
 * attempts, and putting one back to run once what killed it is fixed. Each context
 * initializes one over its own store's outbox, and the staff's backoffice reaches
 * them through these use cases, never through another context's base or store.
 *
 * It has no routes: the backoffice's are the only ones, and they check who asks.
 */
export class Outbox_Module extends Module {

  static initialize(base: CooperBase): Outbox_Module {
    return new Outbox_Module(base)
  }

  private constructor(private readonly base: CooperBase) {
    super('outbox', base.invocations)
  }

  /**
   * A page of its dead jobs, the newest first (by id: one made later has a greater
   * one): they wait for someone, and are few, so they are all read, and the page is
   * cut here, its cursor still good once the job it names was retried.
   */
  @UseCase()
  async dead(page: PageRequest): Promise<Page<DeadJobDTO>> {
    const dead = (await this.base.store.outbox.list({ status: 'dead' })).toSorted((a, b) => (a.id < b.id ? 1 : -1))
    const after = page.cursor ? dead.filter(job => job.id < page.cursor!) : dead
    return toPage(after.slice(0, page.size + 1).map(toDTO), page.size, dead.length)
  }

  /**
   * Puts a dead job back to wait, as new: its worker runs it again at once, with all its
   * attempts. A plain use case: it writes no module's rows through a repository, which
   * is what the write rule watches, but the store's outbox, in one step.
   */
  @UseCase()
  async retry(id: string): Promise<void> {
    if (await this.base.store.outbox.retry(id)) return
    const job = await this.base.store.outbox.get(id)
    throw job ? new JobNotDead(id, job.status) : new JobNotFound(id)
  }
}
```

- `dead(page)` lista los jobs muertos, del más nuevo al más antiguo, una página cada vez.
  Esperan a alguien y son pocos, así que los lee todos y corta la página él mismo, con
  `toPage` de `newt/core`.
- `retry(id)` pone uno otra vez en cola. Si no estaba muerto, dice por qué: no
  encontrado (404), o pendiente, en ejecución o hecho (409). Un job hecho está hecho:
  reintentarlo lo haría dos veces.
- Un job muerto deja fuera el payload de su evento. El personal ve qué reacción falló, en
  qué evento, cuántas veces y por qué; el payload puede decir más de lo que necesitan.
- No tiene rutas. El backoffice del personal (capítulo
  [26](./26-dead-jobs-and-analytics)) lista y reintenta los jobs muertos de todos los
  contextos a través de estos dos casos de uso, tras su propia comprobación de quién
  pregunta.

`retry` escribe en el outbox del store, no en las filas de ningún módulo, así que la
regla de escritura del capítulo [8](./08-two-people-one-card) no tiene nada que decir al
respecto: una petición puede llamarlo.

Lo viste inicializado arriba, el último en `initializeModules`: `boards.modules.outbox`.

## Conectar el mailer

Un test guarda sus emails en una lista. Su mailer también cumple una promesa: un email
cuya clave ya guardó no se guarda otra vez, como un proveedor lo enviaría una sola vez.
Es de la aplicación, compartido por los tests de todos los contextos, así que vive junto
al puerto:

```ts
// cooper/backend/shared/mail/recording-mailer.ts
import type { Mail, Mailer } from './mailer'

/**
 * A mailer that keeps each email in a list instead of sending it: a test's. An email
 * with a key already kept is not kept again, as a provider sends it once.
 */
export class RecordingMailer implements Mailer {

  readonly mails: Mail[] = []

  async send(mail: Mail): Promise<void> {
    if (mail.key !== undefined && this.mails.some(each => each.key === mail.key)) return
    this.mails.push(mail)
  }
}
```

Un test lee sus `mails`, como lee las líneas del log. El `open-test-boards.ts` entero:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { RecordingMailer } from '../../../shared/mail/recording-mailer'
import { Boards_Context } from '../boards.context'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, its emails
 * and its log's lines in lists, and who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mailer = new RecordingMailer()
  const lines: string[] = []
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    mailer,
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    mails: mailer.mails,
    lines,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    /** Until the background work is done: what boards' events made it do. */
    async settled(): Promise<void> {
      await boards.base.jobs.idle()
    },
    async close(): Promise<void> {
      await boards.stop()
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

`t.mails` es la lista del mailer que graba: lo que llegó a la otra parte, con el
duplicado descartado como lo descarta un proveedor.

El backend entrega al contexto un `ConsoleMailer`. Para asignar una tarjeta a otra
persona en acme tiene que haber otra persona, así que carl se une. Este es el `index.ts`
entero:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'
import { FakeAuth } from './contexts/boards/testing/fake-auth'
import { ConsoleMailer } from './shared/mail/console-mailer'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()

// For now auth is a fake one, in memory: ana and carl are in acme, bea in globex (chapter 17 brings the real one).
const auth = await FakeAuth.open()
auth.join('acme', 'ana')
auth.join('acme', 'carl')
auth.join('globex', 'bea')

// For now each card's move is a line on the console (chapter 28 writes it only while tracing).
const boards = await Boards_Context.open(config.boards, {
  workspaces: auth.workspaces,
  mailer: new ConsoleMailer(config.mail.from),
  log: line => console.log(line),
})
// For now, who sends a request says who they are in an `x-user` header (chapter 22 signs them in).
boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId, via: 'web' as const } : null
})
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
```

## Tests

En `card.test.ts`, el test del capítulo [7](./07-cards-and-a-counter) que asigna una
tarjeta solo a un miembro pasa a ser uno que también comprueba el email, y cuatro tests lo
siguen, al final del archivo:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('assigns a card only to a member of its workspace, and tells them by email once saved', async () => {
    const plan = await create('Plan')

    await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })

    await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    expect(t.mails).toEqual([])
    await t.settled()
    expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#1 Plan is yours']])
    // The link opens the card on its board, in boards' UI.
    expect(t.mails[0]!.text).toBe(['Hi bea,', '', 'Card #1, "Plan", is assigned to you.', '', new URL(`/w/acme/boards/${boardId}?card=${plan.id}`, t.boards.config.publicUrl).toString()].join('\n'))

    // Assigning it again to the same one changes nothing, and tells nothing.
    await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await t.settled()
    expect(t.mails).toHaveLength(1)
  })

  test('tells the assignee once, however many times the job of an assignment runs', async () => {
    const { id } = await create('Plan')
    const plan = await inAcme(() => t.modules.card.assign(id, { assigneeId: 'bea' }))

    // The job of one event, run twice (its first run failed after sending), and one of another event.
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-1')
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-1')
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-2')

    expect(t.mails.map(mail => [mail.subject, mail.key])).toEqual([['#1 Plan is yours', 'card.notifyAssignee:event-1'], ['#1 Plan is yours', 'card.notifyAssignee:event-2']])
  })

  test('tells the assignee of a card created for them, and nobody of one assigned and unassigned at once', async () => {
    await create('Plan', { assigneeId: 'bea' })
    const design = await create('Design')
    // To someone else than who gives it, who would hear of it but for the card read again.
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'bea' }))
    await inAcme(() => t.modules.card.unassign(design.id))

    await t.settled()

    expect(t.mails.map(mail => mail.subject)).toEqual(['#1 Plan is yours'])
  })

  test('tells nobody of a card they created for themselves, or took', async () => {
    await create('Plan', { assigneeId: 'ana' })
    const design = await create('Design')
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'ana' }))
    // Given to someone else, they hear of it.
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'bea' }))

    await t.settled()

    expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#2 Design is yours']])
  })

  test('a reaction that keeps failing dies after its attempts, is listed, and runs once retried', async () => {
    // A reaction of the test's own, as if the mail server were down, at its only attempt.
    let down = true
    t.modules.card.events.created.subscribe(() => {
      if (down) throw new Error('the mail server is down')
    // eslint-disable-next-line newt/queue-name
    }, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
    await create('Plan')
    await t.settled()

    const dead = await t.modules.outbox.dead({ size: 10 })
    expect(dead.items).toEqual([expect.objectContaining({ queue: 'test.tellSomeone.on.card.created', event: 'card.created', attempts: 1, lastError: expect.stringContaining('the mail server is down') })])

    down = false
    await t.modules.outbox.retry(dead.items[0]!.id)
    await t.settled()

    expect((await t.modules.outbox.dead({ size: 10 })).total).toBe(0)
    // Done is done: it is not run again.
    await expect(t.modules.outbox.retry(dead.items[0]!.id)).rejects.toMatchObject({ code: 'outbox.job_not_dead', status: 409 })
  })
})
```

- El primero: ningún email justo después de `assign`, el email una vez que el worker se
  ejecutó, con el enlace. Asignarla otra vez a bea no cuenta nada (el retorno anticipado
  del capítulo [10](./10-events)), así que no hay un segundo email.
- El segundo es el job ejecutado dos veces. Llama a `notifyAssignee` como lo haría un
  worker, con el id del evento: dos veces con `event-1`, como un job cuya primera
  ejecución falló después de enviar, y luego una vez con `event-2`, otra asignación. Dos
  emails, uno por evento, cada uno con su clave. (Se ejecuta antes de `settled`, así que
  el email que el worker envía por la asignación aún no está en la lista.)
- El tercero: una tarjeta creada para bea es un email. Una tarjeta dada a bea y quitada
  antes de que el worker se ejecute no es ninguno: `notifyAssignee` la lee otra vez y no
  encuentra a nadie.
- El cuarto: nadie se entera de una tarjeta que se dio a sí mismo.
- El quinto es la vida entera de un job muerto. El test suscribe una reacción propia,
  con **un** intento, que lanza un error mientras "el servidor de correo está caído".
  Tras `settled`, el job está muerto, y `outbox.dead` lo lista con su error. Cuando el
  servidor "vuelve", `retry` lo pone otra vez en cola, el worker lo ejecuta, y la lista
  queda vacía. Reintentarlo otra vez es un 409: está hecho.

La cola del quinto test no es de ningún módulo: no hay un caso de uso al que nombrar, y
`newt/queue-name` la rechazaría. Lo dice donde se lee, con la regla desactivada para esa
línea. Solo un test hace eso.

`attempts: 1` mantiene el test rápido: con los 5 por defecto, el segundo intento
esperaría 10 segundos, y `settled` no espera a un job que aún no toca.

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

Luego, a mano. Arranca el backend (`bun cooper/backend/index.ts`), crea una tarjeta y
asígnala a carl:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
post() { curl -s -X POST "$API$1" -H "$H" -H 'x-user: ana' -d "$2"; }
BOARD=$(post /boards "{\"name\":\"Mail $RANDOM\"}" | jq -r .id)
TODO=$(post /boards/$BOARD/columns '{"name":"To do"}' | jq -r .id)
CARD=$(post /boards/$BOARD/cards "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" | jq -r .id)
post /cards/$CARD/assign '{"assigneeId":"carl"}' | jq -c '{number, assigneeId}'
```

La respuesta llega primero; un momento después la consola del backend muestra el email:

```text
[mail] from cooper <no-reply@cooper.local> to carl@cooper.test: #1 Plan is yours
  Hi carl,
  
  Card #1, "Plan", is assigned to you.
  
  http://localhost:5172/w/acme/boards/01a17958-afda-767a-a367-2b8833ba1c7c?card=01a17958-aff5-714a-9813-1a28017f15a0
```

con los ids de tu tablero y de tu tarjeta. Asígnala a ana, que es quien actúa, y no se
escribe ningún email: se la dio a sí misma.

## En resumen

- Lo que no se puede deshacer (un email, una llamada a otro sistema) sale de un worker,
  después del evento de aquello de lo que trata, nunca del caso de uso que hace el
  cambio. Su job se guarda con el cambio, así que sale solo por lo que se guardó.
- Un worker que se ejecuta tarde lee otra vez aquello de lo que trata antes de actuar:
  puede haber cambiado desde el evento.
- Un job puede ejecutarse dos veces. Lo que envía fuera lleva una clave, el id del
  evento, y la otra parte lo envía una vez: todo `Mailer` debe respetar `key`, uno real
  pasándola como la clave de idempotencia del proveedor.
- Aquello con lo que la aplicación habla fuera (un servicio de correo) es un puerto
  propio, `Mailer`, que se entrega al contexto: la consola en desarrollo, una lista en
  los tests.
- `when` decide, a partir del payload y antes de escribir ningún job, qué eventos toma una
  suscripción. Las reglas de negocio se quedan en el caso de uso.
- Un job que falla se ejecuta otra vez tras un backoff (10 s, duplicándose, hasta 15
  minutos), hasta sus `attempts` (5 por defecto); luego está muerto. El puerto `Outbox`
  lista los jobs (`list`, `get`) y devuelve uno muerto a la cola (`retry`); el
  `Outbox_Module` de cooper lo hace para cada contexto.

Siguiente: [Escuchar a otro contexto](./13-another-context).
