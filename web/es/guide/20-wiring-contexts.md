# Conectar los contextos

Desde el [capítulo 4](./04-who-and-where), boards pregunta a un auth falso quién pertenece
a cada workspace. En el [capítulo 13](./13-another-context) el falso aprendió a contar
`access.revoked`, y en el [capítulo 14](./14-sagas) a crear y borrar workspaces. Mientras
tanto el auth real creció: cuentas y sesiones ([capítulo 17](./17-auth)), workspaces y
acceso ([capítulo 18](./18-tenants-and-access)), invitaciones
([capítulo 19](./19-invitations-and-time)).

Este capítulo saca el falso del servidor. `openContexts` da a boards los casos de uso y los
emisores de auth, y los puertos de boards, sin cambios, responden ahora desde auth. boards
recibe también las rutas que llamará su UI para crear un workspace, invitar a alguien y
quitar a un miembro: puntos de entrada a auth, en el origen propio de boards. El lint
aprende que boards puede usar auth, y nada más entre contextos. Un script de seed llena una
base de datos nueva con un workspace que mirar. FakeAuth se queda, para los tests propios
de boards.

## Qué le pide boards a auth

boards recibe de auth dos tipos de cosas, y son distintas a propósito.

- **Puertos**, en palabras de boards: `workspaces` (quién pertenece a cada uno, del
  [capítulo 4](./04-who-and-where)), `tenants` y `access` (los eventos de auth, de los
  capítulos 13 y 14). Los módulos de boards los necesitan para sus propias reglas, y un
  test da los suyos.
- **Los casos de uso de auth**, tal cual: quién es alguien (`user`), y lo que las rutas de
  boards para workspaces, miembros e invitaciones gestionan en auth (`tenant`, `access`,
  `invitation`). Esto no son puertos. Esas rutas toman y responden con las formas propias
  de auth; un puerto solo repetiría la API de auth uno a uno.

`Boards_Auth` dice a qué módulos de auth puede llamar boards: un `Pick` de `Auth_Modules`.
Nunca el contexto de auth, su base ni su store: con solo módulos en la mano, boards llega a
auth por sus casos de uso y por nada más. Si boards necesita algún día otro módulo de auth,
el cambio se ve en este tipo.

Reemplaza `contexts/boards/initialize-modules.ts`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import { Board_Module } from './modules/board/board.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'
import type { TenantEvents } from './modules/workspace/workspace.deps'
import { Workspace_Module } from './modules/workspace/workspace.module'
import type { CardSearch } from './search/card-search'

/**
 * auth's use cases `boards` calls besides its ports: who someone is, and what boards'
 * routes for workspaces, members and invitations manage in auth.
 */
export type Boards_Auth = Pick<Auth_Modules, 'user' | 'tenant' | 'access' | 'invitation'>

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about workspaces and
 * access) and as auth's use cases, a mailer, and where the cards are searched. Whoever
 * opens the context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  auth: Boards_Auth
  mailer: Mailer
  search: CardSearch
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl, search: deps.search })
  const { tenant, access, invitation, user } = deps.auth
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants, auth: { tenant, access, invitation, user } })
  const activity = Activity_Module.initialize(base, { card, member, tenants: deps.tenants }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

`Boards_ModuleDeps` recibe `auth`, y el módulo workspace recibe los cuatro módulos de auth.
Los otros módulos no reciben nada nuevo: los módulos card y member siguen preguntando por
sus puertos.

Di lo mismo en `boards.context.ts`. Reemplaza su comentario, y añade uno a `open`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
/**
 * The SaaS: each workspace's boards, their columns and cards. `auth` keeps the
 * workspaces and who belongs to each: `boards` asks it through ports it is handed when
 * it opens, and calls its use cases.
 */
export class Boards_Context extends ServedContext {
// …
  /** Opened after `auth`, which it uses. */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps): Promise<Boards_Context> {
```

## Muchos usuarios a la vez: `user.getMany`

La pantalla de miembros lista a quién pertenece a un workspace: sus accesos, y los usuarios
a los que corresponden. Un `user.get` por acceso sería una consulta cada uno. Añade
`getMany` al `user.module.ts` de auth, después de `get`:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
  /** For other modules and contexts: the ones with these ids, in no order; an id of none is not there. */
  @UseCase()
  async getMany(ids: string[]): Promise<UserDTO[]> {
    if (ids.length === 0) return []
    return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(user => user.toDTO())
  }
```

Responde con los usuarios que encuentra, sin orden. Un llamante que los quiera por id hace
un `Map`, como verás.

## boards sobre auth: `boardsOnAuth`

`openContexts` abre primero auth, luego boards, y conecta los puertos de boards a auth.
Reemplaza `open-contexts.ts`:

```ts
// cooper/backend/open-contexts.ts
import type { Clock } from 'newt/core'
import type { Config } from './config'
import { Auth_Context } from './contexts/auth/auth.context'
import { WORKSPACES_PRODUCT } from './contexts/auth/modules/product/product.schema'
import { Boards_Context } from './contexts/boards/boards.context'
import { MemoryCardSearch } from './contexts/boards/search/memory-card-search'
import type { Boards_ModuleDeps } from './contexts/boards/initialize-modules'
import { ConsoleMailer } from './shared/mail/console-mailer'
import type { Mailer } from './shared/mail/mailer'

/** What the contexts are given from outside: the console mailer unless another is, and the real time unless a test gives a clock. */
export type OpenContextsOptions = {
  mailer?: Mailer
  clock?: Clock
}

/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`. The server opens them, and so does any script
 * that works with their modules (the seed).
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  const { clock } = options
  const auth = await Auth_Context.open(config.auth, { mailer }, clock)
  // For now each card's move is a line on the console (chapter 28 writes it only while tracing).
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, search: new MemoryCardSearch(), log: line => console.log(line) })
  return { auth, boards, all: [auth, boards] as const }
}

/**
 * What `boards` asks of auth, wired to auth's use cases and events. A workspace is a
 * tenant of the product `cooper`, and its members are those with access to it while
 * it is there.
 * boards' reactions to auth's events are subscribed on auth's emitters: they are jobs
 * of auth's outbox, run by auth's worker (`auth.base.jobs.idle()`, then boards').
 */
function boardsOnAuth(auth: Auth_Context): Omit<Boards_ModuleDeps, 'mailer' | 'search' | 'log'> {
  const { access, user, tenant, invitation } = auth.modules
  // A deleted tenant is not among them.
  const exists = async (workspaceId: string) => (await tenant.getMany([workspaceId])).length > 0
  // An access and a tenant still there: a deleted workspace's accesses go a moment
  // after it (or, should that fail, from its worker), and nobody enters it meanwhile.
  const isMember = async (workspaceId: string, userId: string) => {
    const [granted, alive] = await Promise.all([access.check(userId, WORKSPACES_PRODUCT, workspaceId), exists(workspaceId)])
    return granted !== null && alive
  }
  return {
    workspaces: {
      isMember,
      member: async (workspaceId, userId) => {
        if (!await isMember(workspaceId, userId)) return null
        const [found] = await user.getMany([userId])
        return found ? { id: found.id, name: found.name, email: found.email } : null
      },
      exists,
    },
    tenants: tenant.events,
    access: access.events,
    auth: { user, tenant, access, invitation },
  }
}

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
```

FakeAuth ya no está en este archivo. `boardsOnAuth` es donde las palabras de boards pasan a
ser las de auth:

- **Un workspace es un tenant del producto `cooper`**: `WORKSPACES_PRODUCT`, que auth
  declara junto a sus productos ([capítulo 18](./18-tenants-and-access)). Es una
  constante, no un módulo: importarla no da a boards ninguna vía a los datos de auth.
- **`exists`**, que pregunta un worker de boards antes de escribir en un workspace que puede
  haber desaparecido ([capítulo 14](./14-sagas)), es `tenant.getMany`, que deja fuera los
  tenants borrados.
- **`isMember`** pregunta a la vez a `access.check` y a `exists`. Borrar un workspace guarda
  el tenant, y luego quita sus accesos en un segundo guardado
  ([capítulo 18](./18-tenants-and-access)). Entre los dos, o si el segundo falla y su
  worker todavía no se ha ejecutado, los accesos siguen ahí. Preguntar también si el
  tenant existe deja fuera a todos desde el momento en que se borra. Un test más abajo hace
  fallar el segundo guardado y lo comprueba.
- **`member`** es `isMember`, y luego el usuario.
- **`tenants` y `access`** son los emisores de auth, `tenant.events` y `access.events`. Un
  puerto solo pide `subscribe`, y un emisor lo tiene: encajan tal cual.

### De quién es el worker que ejecuta cada job

El job de un `handler` se escribe en el store del guardado que cuenta el evento
([capítulo 13](./13-another-context)). boards se suscribe a los emisores de auth, así que
sus reacciones a los eventos de auth son **jobs del outbox de auth, ejecutados por el
worker de auth**:

| Job | Outbox | Lo ejecuta |
|---|---|---|
| `workspace.prepare.on.tenant.created` | el de auth | el worker de auth |
| `workspace.purge.on.tenant.deleted` | el de auth | el worker de auth |
| `activity.purgeWorkspace.on.tenant.deleted` | el de auth | el worker de auth |
| `card.unassignMember.on.access.revoked` | el de auth | el worker de auth |
| `card.notifyAssignee`, `card.indexCard`, `activity.record…`, … | el de boards | el worker de boards |

`workspace.prepare` se ejecuta en el worker de auth y escribe el tablero, las columnas y la
tarjeta de boards, en el store de boards. Esos guardados cuentan `card.created` y el resto,
cuyos jobs van al outbox de boards. Así que quien espera al trabajo en segundo plano espera
primero a los jobs de auth, y luego a los de boards. El test y el seed de más abajo hacen
exactamente eso.

FakeAuth hacía lo mismo desde su propio store, así que nada cambia en boards: se escribió
para esto desde el capítulo 13.

### El producto, por su nombre

En el [capítulo 13](./13-another-context) la reacción de las tarjetas a `access.revoked`
nombraba a mano el producto `'cooper'`, a la espera de la constante de auth. Úsala ahora.
En `card.workers.ts`, impórtala:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
import { WORKSPACES_PRODUCT } from '../../../auth/modules/product/product.schema'
import type { Card_Deps, RevokedAccess } from './card.deps'
```

y reemplaza la última suscripción, quitando el comentario que decía "de momento":

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
  // auth took someone's access to a workspace: their cards there are left unassigned.
  // auth tells every access it takes away, to any product: only a workspace's is boards'.
  deps.access.revoked.subscribe(access => cards.unassignMember(access.tenantId, access.userId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
    when: (access: RevokedAccess): access is RevokedAccess & { tenantId: string } => access.productId === WORKSPACES_PRODUCT && access.tenantId !== null,
  })
```

## Workspaces, miembros e invitaciones, a través de boards

La gente gestiona sus workspaces desde la UI de boards: crea uno, lo renombra, invita a
alguien, quita a alguien. Todo eso es de auth. Pero la UI vive en el origen de boards, con
la sesión de boards ([capítulo 22](./22-web-session)). Así que boards tiene rutas para
ellos, y cada ruta llama al caso de uso de auth.

### Las deps

El módulo workspace recibe los módulos de auth. Reemplaza
`modules/workspace/workspace.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.deps.ts
import type { EventSource } from 'newt/core'
import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Invitation_Module } from '../../../auth/modules/invitation/invitation.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module } from '../../../auth/modules/user/user.module'
import type { Board_Module } from '../board/board.module'
import type { Card_Module } from '../card/card.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

/**
 * auth's events about workspaces (its tenants) that boards reacts to, as a port: what
 * boards needs of them, in its own words. auth's emitters fit it; a test hands its own.
 */
export type TenantEvents = {
  created: EventSource<{ id: string }>
  deleted: EventSource<{ id: string }>
}

/**
 * auth's modules, whose use cases boards' routes for workspaces, members and
 * invitations call: auth keeps all three, and boards' UI manages them through boards'
 * own origin. A route of boards calls them as any client would: what they
 * write is auth's, and auth's own rules guard it. A use case of boards only reads
 * them, to put together what its screens show.
 *
 * Unlike what `member` and `card` ask of auth, this is not a port in boards' words:
 * those routes are entry points into auth, taking and answering auth's own shapes,
 * and a port would only repeat auth's API one to one.
 */
export type WorkspaceAuth = {
  tenant: Tenant_Module
  access: Access_Module
  invitation: Invitation_Module
  user: User_Module
}

export interface Workspace_Deps {
  board: Board_Module
  column: Column_Module
  card: Card_Module
  member: Member_Module
  tenants: TenantEvents
  auth: WorkspaceAuth
}
```

`WorkspaceAuth` nombra los cuatro módulos por sus clases. Es lo mismo que `Boards_Auth`,
escrito en las deps del propio módulo, como cada módulo escribe lo que recibe.

### Las formas con las que responde boards

Los tenants, accesos e invitaciones de auth, en palabras de boards. Añade a
`modules/workspace/workspace.schema.ts` dos imports al principio:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.schema.ts
import { Email } from 'newt/contract'
import { z } from 'zod'
import type { BoardDTO } from '../board/board.schema'
```

y, después de `WELCOME_BOARD`, los esquemas y dos funciones que los hacen:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.schema.ts
/*
 * Workspaces, their members and their invitations are auth's (its tenants, accesses
 * and invitations). boards' UI manages them through boards' own origin, and these are
 * the shapes boards' routes answer with: auth's, in boards' words.
 */

/** A workspace, as the signed-in person sees it: whether they are its admin (who made it; there is one). */
export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Its admin's user id, in auth. */
  adminId: z.string(),
  /** Whether the signed-in person is its admin: who renames it, deletes it, invites and removes. */
  isAdmin: z.boolean(),
  createdAt: z.string(),
})

/** Someone who belongs to a workspace, as its members' screen shows them. */
export const WorkspaceMemberSchema = z.object({
  /** Their user id, in auth: what a card's assignee is. */
  id: z.string(),
  name: z.string(),
  email: Email.schema,
  isAdmin: z.boolean(),
})

/** An invitation to a workspace still waiting, as its admin sees it. */
export const WorkspaceInvitationSchema = z.object({
  id: z.string(),
  email: Email.schema,
  status: z.enum(['pending', 'accepted', 'revoked']),
  createdAt: z.string(),
  expiresAt: z.string(),
})

/** What an invitation's link shows, to anyone who has it, before it is accepted. */
export const InvitationReviewSchema = z.object({
  workspaceName: z.string(),
  /** Who may accept it: whoever signs in with this email. */
  email: Email.schema,
  /** The name of who invited them. */
  invitedBy: z.string(),
})

export type WorkspaceDTO = z.infer<typeof WorkspaceSchema>
export type WorkspaceMemberDTO = z.infer<typeof WorkspaceMemberSchema>
export type WorkspaceInvitationDTO = z.infer<typeof WorkspaceInvitationSchema>
export type InvitationReviewDTO = z.infer<typeof InvitationReviewSchema>

/** A tenant of auth as a workspace of boards, for whoever is looking at it. */
export function workspaceOf(tenant: { id: string, name: string, createdBy: string, createdAt: string }, userId: string): WorkspaceDTO {
  return { id: tenant.id, name: tenant.name, adminId: tenant.createdBy, isAdmin: tenant.createdBy === userId, createdAt: tenant.createdAt }
}

/** An invitation of auth as its workspace's admin sees it: never who accepted it. */
export function workspaceInvitationOf(invitation: WorkspaceInvitationDTO): WorkspaceInvitationDTO {
  const { id, email, status, createdAt, expiresAt } = invitation
  return { id, email, status, createdAt, expiresAt }
}
```

`workspaceOf` responde si quien mira es el admin, para que la UI sepa qué botones mostrar.
`workspaceInvitationOf` copia solo los campos que se le muestran al admin: el DTO de auth
tiene más (quién invitó, quién aceptó), y un objeto con campos de más sigue encajando en el
tipo, así que la función los elige a mano.

### Leer auth: `mine` y `members`

Dos casos de uso de boards leen auth, para componer lo que muestran sus pantallas. En
`workspace.module.ts`, reemplaza los imports:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
import { allPages, currentActor, Module, UseCase } from 'newt/core'
import { WORKSPACES_PRODUCT } from '../../../auth/modules/product/product.schema'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
import type { Workspace_Deps } from './workspace.deps'
import { registerWorkspaceRoutes } from './workspace.routes'
import { WELCOME_BOARD, workspaceOf, type BoardViewDTO, type WorkspaceDTO, type WorkspaceMemberDTO } from './workspace.schema'
import { registerWorkspaceWorkers } from './workspace.workers'
```

y añádelos después de `boardView`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
  /**
   * The workspaces the signed-in person belongs to, the ones they joined last first.
   * auth keeps them: this only reads it, its accesses to `cooper` and their tenants.
   */
  @UseCase()
  async mine(): Promise<WorkspaceDTO[]> {
    const { userId } = currentActor()
    const accesses = await allPages(page => this.deps.auth.access.listForUser(userId, page, WORKSPACES_PRODUCT))
    const tenants = new Map((await this.deps.auth.tenant.getMany(accesses.flatMap(access => access.tenantId ?? []))).map(tenant => [tenant.id, tenant]))
    // A workspace deleted while this read, or whose accesses its deletion failed to take away (its worker will), is left out.
    return accesses.flatMap(access => {
      const tenant = tenants.get(access.tenantId ?? '')
      return tenant ? [workspaceOf(tenant, userId)] : []
    })
  }

  /**
   * Who belongs to the current workspace, its admin first: auth's accesses to it, and
   * the users they are for. It only reads auth.
   */
  @UseCase()
  async members(): Promise<WorkspaceMemberDTO[]> {
    const accesses = await allPages(page => this.deps.auth.access.listForTenant(currentWorkspaceId(), page))
    const users = new Map((await this.deps.auth.user.getMany(accesses.map(access => access.userId))).map(user => [user.id, user]))
    return accesses.flatMap(access => {
      const user = users.get(access.userId)
      return user ? [{ id: user.id, name: user.name, email: user.email, isAdmin: access.role === 'admin' }] : []
    })
  }
```

`allPages` ([capítulo 16](./16-search-port)) lee todas las páginas de un caso de uso
paginado en un solo array. Funciona igual con los casos de uso de otro contexto:
`listForUser` toma un `PageRequest` y responde con una `Page`, como los de boards. Úsalo
para lo que la pantalla muestra entero de todos modos: los workspaces de alguien, los
miembros de un workspace. Así cada caso de uso pide todos los tenants, o todos los
usuarios, en una sola llamada, y los une por id.

Los dos solo leen. Un caso de uso de boards que llama a un caso de uso de auth está
llamando a la API de otro contexto: el `listForUser` de auth se ejecuta como la raíz de lo
que hace en auth, bajo las reglas de auth, como si lo hubiera llamado alguien de fuera.

### Las rutas: puntos de entrada a auth

Reemplaza `modules/workspace/workspace.routes.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
import { allPages, currentActor } from 'newt/core'
import { WORKSPACES_PRODUCT } from '../../../auth/modules/product/product.schema'
import { InvitationNotOpen } from '../../../auth/modules/invitation/errors/invitation-not-open'
import type { InvitationCreateDTO } from '../../../auth/modules/invitation/invitation.schema'
import type { TenantCreateDTO, TenantRenameDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'
import { workspaceInvitationOf, workspaceOf, type InvitationReviewDTO } from './workspace.schema'

const noContent = () => new Response(null, { status: 204 })

export function registerWorkspaceRoutes(base: BoardsBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)
  const { tenant, access, invitation } = deps.auth

  workspace.get('/boards/:boardId/view', async request => Response.json(await workspaces.boardView(request.params.boardId)))

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

  workspace.delete('', async request => {
    await tenant.delete(request.params.workspaceId)
    return noContent()
  })

  workspace.get('/members', async () => Response.json(await workspaces.members()))

  // Its admin removes someone, or a member leaves: their cards are unassigned a moment later.
  workspace.delete('/members/:userId', async request => {
    await access.revoke({ userId: request.params.userId, productId: WORKSPACES_PRODUCT, tenantId: request.params.workspaceId })
    return noContent()
  })

  workspace.get('/invitations', async request => {
    const pending = await allPages(page => invitation.list(request.params.workspaceId, page))
    return Response.json(pending.map(workspaceInvitationOf))
  })

  workspace.post('/invitations', async request => {
    const created = await invitation.create(request.params.workspaceId, await request.json() as InvitationCreateDTO)
    return Response.json(workspaceInvitationOf(created), { status: 201 })
  })

  workspace.delete('/invitations/:invitationId', async request => {
    await invitation.revoke(request.params.invitationId)
    return noContent()
  })

  // An invitation's link, before signing in: what it is for. One that opens nothing says so.
  base.http.get('/invitations/:token', async request => {
    const review = await invitation.review(request.params.token)
    if (!review.open) throw new InvitationNotOpen()
    const answer: InvitationReviewDTO = { workspaceName: review.tenantName, email: review.email, invitedBy: review.invitedByName }
    return Response.json(answer)
  }, { public: true })

  // Signed in with the invited email: the person joins the workspace.
  base.http.post('/invitations/:token/accept', async request => {
    const accepted = await invitation.accept(request.params.token)
    return Response.json({ workspaceId: accepted.tenantId })
  })
}
```

- `GET /workspaces` y `POST /workspaces` están en `base.http`: todavía no hay workspace en
  la ruta. Una persona con sesión crea uno con `tenant.create`, y es su admin.
- `PATCH` y `DELETE` sobre el workspace, sus miembros y sus invitaciones están en
  `workspace` ([capítulo 4](./04-who-and-where)): solo un miembro pasa, cualquier otro
  recibe un 404. auth comprueba al admin.
- `DELETE /members/:userId` es `access.revoke`: el admin quita a alguien, o un miembro se
  va. La reacción de las tarjetas ([capítulo 13](./13-another-context)) desasigna sus
  tarjetas un momento después.
- `GET /invitations/:token` es **pública**: Bob abre su enlace antes de iniciar sesión.
  Responde solo lo que necesita la página, y un enlace que no abre nada lo dice con
  `invitation.not_open`.
- `POST /invitations/:token/accept` necesita a alguien con sesión, y auth comprueba que es
  el email invitado.

Una ruta no es un caso de uso. Es un adaptador, como las rutas propias de auth, así que lo
que llama en auth es la raíz de lo que auth hace: `tenant.create` escribe el tenant y el
acceso del admin bajo su propio `writesTo`, y la regla de escritura se cumple dentro de
auth como siempre. La petición se ejecuta como la persona que ha iniciado sesión en boards,
así que el `currentActor()` de auth es esa persona.

¿Por qué no un caso de uso de boards, digamos `workspace.create`, que llame a
`tenant.create`? newt lo permitiría. Pero entonces un caso de uso de boards escribiría en
dos stores. Si hiciera algo en boards después de la llamada y fallara, la parte de auth se
quedaría y nadie terminaría la de boards. cooper mantiene una regla más simple:

> **Ningún caso de uso de boards escribe en auth.** Los casos de uso de boards solo leen
> auth (`mine`, `members`). Las escrituras en auth empiezan en una ruta. boards se entera de
> lo que hizo auth por sus eventos, desde un worker: el tablero de bienvenida de un
> workspace nuevo.

Llamar a otro contexto es como llamar a una API externa, como un proveedor de pagos: lo que
guardó se queda guardado, haga lo que haga tu lado después. Llámalo después de lo que pueda
fallar en tu lado, y haz que la llamada se pueda repetir sin riesgo.

## FakeAuth se queda, para los tests de boards

Los tests propios de boards siguen abriendo boards solo, con FakeAuth detrás de sus
puertos. Nunca llegan a los casos de uso de auth: las rutas que sí llegan se prueban con el
auth real, en el test de cooper de más abajo. Pero `Boards_ModuleDeps` quiere ahora `auth`.
FakeAuth da un objeto que falla, diciéndolo, si algo lo llama. En `testing/fake-auth.ts`,
importa el tipo:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
import { Base } from 'newt/runtime'
import type { Boards_Auth } from '../initialize-modules'
import type { AccessEvents } from '../modules/card/card.deps'
```

y añade `modules` después de `access`:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
  readonly tenants: TenantEvents
  readonly access: AccessEvents

  /**
   * auth's use cases, which boards' own tests never reach: who signs in, and the
   * routes for workspaces, members and invitations, which run on the real auth in
   * cooper's test (`cooper/backend/cooper.test.ts`). Any call says so.
   */
  readonly modules = new Proxy({}, {
    get: (_, module) => new Proxy({}, {
      get: (__, useCase) => () => Promise.reject(new Error(`auth.${String(module)}.${String(useCase)} is not in boards' own tests: cooper.test.ts runs it on the real auth`)),
    }),
  }) as Boards_Auth
```

Cualquier `auth.<módulo>.<casoDeUso>` es una función que rechaza con ese mensaje. En
`testing/open-test-boards.ts`, dáselo:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
    access: auth.access,
    auth: auth.modules,
    mailer: { send: async mail => { mails.push(mail) } },
```

FakeAuth está ahora solo en `testing/`, y solo `openTestBoards` lo abre.

## El lint: boards usa auth

Los archivos de boards importan ahora los de auth: `workspace.deps.ts` nombra las clases de
módulo de auth, y `card.workers.ts` y `workspace.routes.ts` importan `WORKSPACES_PRODUCT` y
los esquemas de auth. Desde el [capítulo 17](./17-auth) el lint decía `boards: []`, y ahora
dice que no:

```text
cooper/backend/contexts/boards/modules/workspace/workspace.deps.ts
  2:36  error  '../../../auth/modules/access/access.module' is the context auth's, and boards uses no other context: contexts use only the ones they say, never in a cycle          newt/context-boundaries
  3:40  error  '../../../auth/modules/invitation/invitation.module' is the context auth's, and boards uses no other context: contexts use only the ones they say, never in a cycle  newt/context-boundaries
  …
```

`newt/context-boundaries` lee dónde cae cada import: un archivo en la carpeta de un
contexto importa solo los contextos que ese contexto `uses`. `uses` nombra todos los
contextos, y debe ser un árbol: `auth: ['boards']` junto a `boards: ['auth']` sería un
ciclo, y el preset lanza un error al construirse. Así que auth nunca puede importar
boards, y boards oye a auth solo por puertos, eventos y los casos de uso que se le dan.

Di que boards usa auth, y haz lint también de los scripts (el seed viene ahora). En
`eslint.config.js`:

```js
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'] } },
})
```

El lint del preset usa información de tipos (rechaza una promesa sin esperar), así que
cada archivo al que hace lint debe estar en un proyecto de TypeScript. Los scripts no son
parte del backend: crea un proyecto para ellos, `tsconfig.node.json`, en la raíz:

```json
{
  // The tools around the application: cooper's scripts.
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "moduleDetection": "force",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true
  },
  "include": ["cooper/scripts/**/*.ts"],
  "exclude": ["**/node_modules"]
}
```

y refiérelo desde el `tsconfig.json` de la raíz:

```json
{
  // The whole repository, as its projects: the framework (newt), what runs on the
  // server (cooper's backend), and the tools around them (scripts). `bunx tsc -b`
  // follows the references. newt is not among any paths: it is a workspace package,
  // reached through its `exports` as any application reaches it.
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

## Un seed

Con auth de verdad, una base de datos nueva no tiene a nadie, y cada comprobación a mano
empezaría por registrarse, crear un workspace e invitar a alguien. Un script de seed lo
hace una vez. Abre los contextos con `openContexts`, como el servidor, y escribe por sus
casos de uso, como lo haría cualquiera: nada de SQL, ni filas a mano, así que se cumplen
todas las reglas y todos los eventos. Crea `cooper/scripts/seed.ts`:

```ts
// cooper/scripts/seed.ts
// bun run cooper:seed: cooper's demo data, written through the contexts' use cases as
// anyone would: Ana's workspace Acme, where Bob joined by accepting her invitation.
// Safe to run again: what is there stays.
import { runAsActor, type Email } from 'newt/core'
import { config } from '../backend/config'
import { inWorkspace } from '../backend/contexts/boards/workspace-scope'
import { openContexts, stopContexts } from '../backend/open-contexts'
import { ConsoleMailer } from '../backend/shared/mail/console-mailer'
import type { Mail } from '../backend/shared/mail/mailer'

/** Every demo account's password: it is demo data, on a developer's computer. */
const PASSWORD = 'cooper-demo'

// The emails leave to the console, as in development, and the seed reads Bob's link.
const mails: Mail[] = []
const console_ = new ConsoleMailer(config.mail.from)
const contexts = await openContexts(config, { mailer: { send: async mail => { mails.push(mail); await console_.send(mail) } } })
/**
 * Until the background work is done: auth's jobs first, boards' reactions to auth's
 * events among them (Acme's welcome board), then what those made boards tell.
 */
const settled = async () => {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}

try {
  const { user, access, tenant, invitation } = contexts.auth.modules

  /** An account, made the first time. */
  const account = async (email: string, name: string) => (await user.findByEmail(email)) ?? user.signUp({ email, name, password: PASSWORD })

  const ana = await account('ana@cooper.dev', 'Ana García')
  const bob = await account('bob@cooper.dev', 'Bob Smith')
  const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id, via: 'web' }, fn)

  const anas = await tenant.listForUser(ana.id, { size: 100 })
  const acme = anas.items.find(each => each.name === 'Acme' && each.createdBy === ana.id) ?? await asAna(() => tenant.create({ name: 'Acme' }))

  if (!(await access.check(bob.id, 'cooper', acme.id))) {
    const pending = await asAna(() => invitation.list(acme.id, { size: 100 }))
    const invited = pending.items.find(each => each.email === bob.email) ?? await asAna(() => invitation.create(acme.id, { email: bob.email }))
    // A pending invitation from an earlier run sends its link again.
    if (pending.items.includes(invited)) await invitation.send(invited.id)
    await settled()
    const link = mails.findLast(mail => mail.to === (bob.email as Email))!.text.match(/invitations\/([A-Za-z0-9_-]{43})/)![1]!
    await runAsActor({ userId: bob.id, via: 'web' }, () => invitation.accept(link))
  }
  await settled()

  // A second board, "Launch", made by Ana in Acme as she would from boards' UI.
  const { board, column, card } = contexts.boards.modules
  await asAna(() => inWorkspace(contexts.boards.modules.member, acme.id, async () => {
    if (await board.findByName('Launch')) return
    const launch = await board.create({ name: 'Launch', description: 'Everything left before Acme\'s launch.' })
    const [backlog, doing, review, done] = [
      await column.add(launch.id, { name: 'Backlog' }),
      await column.add(launch.id, { name: 'In progress' }),
      await column.add(launch.id, { name: 'Review' }),
      await column.add(launch.id, { name: 'Done' }),
    ]
    const cards = [
      { columnId: backlog.id, title: 'Write the press release', assigneeId: ana.id },
      { columnId: backlog.id, title: 'Plan the launch party', assigneeId: null },
      { columnId: doing.id, title: 'Finish the pricing page', assigneeId: bob.id },
      { columnId: doing.id, title: 'Record the demo video', assigneeId: ana.id },
      { columnId: review.id, title: 'Check the sign-up emails', assigneeId: bob.id },
      { columnId: done.id, title: 'Pick the launch date', description: 'The first Monday of next month.', assigneeId: ana.id },
    ]
    for (const each of cards) await card.create(launch.id, each)
  }))
  await settled()

  console.log([
    '',
    'cooper is seeded. Every account\'s password is', `  ${PASSWORD}`,
    '',
    `  ana@cooper.dev     Acme's admin, ${config.boards.publicUrl}: its boards Welcome and Launch`,
    '  bob@cooper.dev     a member of Acme, who accepted Ana\'s invitation',
    '',
  ].join('\n'))
} finally {
  await stopContexts(contexts)
}
```

- Su mailer guarda cada email, y además lo escribe en la consola. El seed lee el enlace de
  Bob del email que envía la invitación de Ana, y lo acepta como Bob: el mismo camino que
  sigue una persona.
- `settled` espera a los jobs de auth, y luego a los de boards. El tablero de bienvenida de
  Acme lo hace el worker de auth, con `tenant.created`.
- Cada paso mira primero: `account` busca el email antes de registrarse, Acme se busca
  entre los tenants de Ana, Bob se invita solo si no es miembro, y una invitación pendiente
  de una ejecución anterior envía su enlace de nuevo (el token del primer enlace nunca se
  guardó). "Launch" se crea solo si el workspace de Ana no tiene ningún tablero con ese
  nombre. Ejecútalo dos veces y la segunda no cambia nada.
- Se ejecuta como Ana con `runAsActor`, y en Acme con `inWorkspace`
  ([capítulo 4](./04-who-and-where)), como lo haría una petición a boards.
- Detiene los contextos al final, pase lo que pase.

Añade el script al `package.json` de la raíz, después de `docs:build`:

```json
    "docs:build": "vitepress build web",
    "cooper:seed": "bun run cooper/scripts/seed.ts"
```

## Tests

### cooper de extremo a extremo

Los tests propios de boards usan FakeAuth; los de auth usan solo auth. Ninguno ve los dos
juntos. Crea `cooper/backend/cooper.test.ts`, que abre los dos como el servidor, sobre
SQLite en memoria, y llama a boards por HTTP como lo hará su UI:

```ts
// cooper/backend/cooper.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
import { browser, freePort, type Browser } from 'newt/testing'
import { config, type Config } from './config'
import { inWorkspace } from './contexts/boards/workspace-scope'
import { openContexts, stopContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'

/**
 * cooper end to end: auth and boards open as the server opens them, on SQLite in
 * memory, and boards used as its UI uses it, over HTTP.
 */

function testConfig(authPort: number, boardsPort: number): Config {
  const boardsUrl = `http://localhost:${boardsPort}`
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: authPort, boardsPublicUrl: boardsUrl },
    boards: { ...config.boards, database: ':memory:', port: boardsPort, publicUrl: boardsUrl },
  }
}

let contexts: Awaited<ReturnType<typeof openContexts>>
let servers: Server<undefined>[]
let mails: Mail[]

beforeEach(async () => {
  mails = []
  contexts = await openContexts(testConfig(freePort(), freePort()), { mailer: { send: async mail => { mails.push(mail) } } })
  // For now boards is told who sends a request by an `x-user` header (chapter 22 signs them in through auth).
  contexts.boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  servers = [serve(contexts.auth.serving()), serve(contexts.boards.serving())]
})

afterEach(async () => {
  await Promise.all(servers.map(server => server.stop()))
  await stopContexts(contexts)
})

const boardsUrl = (path: string) => new URL(path, contexts.boards.config.publicUrl).toString()

/** Until the background work is done: auth's jobs (boards' reactions to auth's events among them), then boards'. */
async function settled() {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}

/**
 * Someone signs up to cooper. For now boards is told who they are by an `x-user`
 * header on each request (chapter 22 signs them in through auth's pages).
 */
async function signUp(email: string, name: string): Promise<{ as: Browser, id: string }> {
  const { id } = await contexts.auth.modules.user.signUp({ email, name, password: 'a long password' })
  const as = browser()
  return { as: (address, init) => as(address, { ...init, headers: { 'x-user': id } }), id }
}

/** boards' API, as its UI calls it. */
async function call<T = unknown>(as: Browser, method: string, path: string, json?: unknown) {
  const response = await as(boardsUrl(`/api${path}`), { method, json })
  return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
}

type Workspace = { id: string, name: string, adminId: string, isAdmin: boolean, createdAt: string }
type View = { board: { id: string, name: string }, columns: { id: string, name: string }[], cards: { id: string, title: string, assigneeId: string | null }[] }

/** Ana's workspace Acme, with its welcome board, and Bob in it, who accepted her invitation. */
async function acmeWithBob() {
  const ana = await signUp('ana@cooper.test', 'Ana')
  const acme = (await call<Workspace>(ana.as, 'POST', '/workspaces', { name: 'Acme' })).body
  const invited = await call<{ id: string, email: string, status: string }>(ana.as, 'POST', `/workspaces/${acme.id}/invitations`, { email: 'bob@cooper.test' })
  expect(invited).toMatchObject({ status: 201, body: { email: 'bob@cooper.test', status: 'pending' } })
  await settled()
  const token = mails.findLast(mail => mail.to === 'bob@cooper.test')!.text.match(/invitations\/([A-Za-z0-9_-]{43})/)![1]!

  const bob = await signUp('bob@cooper.test', 'Bob')
  expect(await call(browser(), 'GET', `/invitations/${token}`)).toEqual({ status: 200, body: { workspaceName: 'Acme', email: 'bob@cooper.test', invitedBy: 'Ana' } })
  expect(await call(bob.as, 'POST', `/invitations/${token}/accept`)).toEqual({ status: 200, body: { workspaceId: acme.id } })
  return { ana, bob, acme, token }
}

async function welcomeOf(as: Browser, workspaceId: string): Promise<View> {
  const boards = (await call<{ items: { id: string }[] }>(as, 'GET', `/workspaces/${workspaceId}/boards`)).body
  return (await call<View>(as, 'GET', `/workspaces/${workspaceId}/boards/${boards.items[0]!.id}/view`)).body
}

describe('workspaces, through boards', () => {
  test('a new workspace is its maker\'s, and gets its welcome board a moment later', async () => {
    const { as, id } = await signUp('ana@cooper.test', 'Ana')
    expect(await call(as, 'POST', '/workspaces', { name: '' })).toMatchObject({ status: 400, body: { code: 'validation' } })

    const created = await call<Workspace>(as, 'POST', '/workspaces', { name: 'Acme' })
    expect(created).toMatchObject({ status: 201, body: { name: 'Acme', adminId: id, isAdmin: true } })
    const acme = created.body
    expect((await call(as, 'GET', '/workspaces')).body).toEqual([acme])
    expect((await call(as, 'GET', `/workspaces/${acme.id}/boards`)).body).toMatchObject({ total: 0 })

    await settled()
    const welcome = await welcomeOf(as, acme.id)
    expect(welcome.board.name).toBe('Welcome')
    expect(welcome.columns.map(column => column.name)).toEqual(['To do', 'Doing', 'Done'])

    expect(await call(as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Acme Inc' })).toMatchObject({ status: 200, body: { id: acme.id, name: 'Acme Inc', isAdmin: true } })
    expect(await call(as, 'GET', `/workspaces/${acme.id}/members`)).toEqual({ status: 200, body: [{ id, name: 'Ana', email: 'ana@cooper.test', isAdmin: true }] })
  })

  test('an invitation is accepted by who has its email, and only its admin manages the workspace', async () => {
    const { ana, bob, acme, token } = await acmeWithBob()

    expect((await call(bob.as, 'GET', '/workspaces')).body).toEqual([{ ...acme, isAdmin: false }])
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/members`)).body).toEqual([
      { id: ana.id, name: 'Ana', email: 'ana@cooper.test', isAdmin: true },
      { id: bob.id, name: 'Bob', email: 'bob@cooper.test', isAdmin: false },
    ])
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/invitations`)).body).toEqual([])
    // Spent: the link opens nothing any more.
    expect(await call(browser(), 'GET', `/invitations/${token}`)).toMatchObject({ status: 409, body: { code: 'invitation.not_open' } })

    // A member works in it, but only its admin renames it, invites or deletes it.
    expect(await call(bob.as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Mine' })).toMatchObject({ status: 403, body: { code: 'tenant.not_admin' } })
    expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/invitations`)).status).toBe(403)
    expect((await call(bob.as, 'DELETE', `/workspaces/${acme.id}`)).status).toBe(403)

    // A pending invitation, revoked by the admin.
    const carla = (await call<{ id: string }>(ana.as, 'POST', `/workspaces/${acme.id}/invitations`, { email: 'carla@cooper.test' })).body
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/invitations`)).body).toEqual([expect.objectContaining({ id: carla.id, email: 'carla@cooper.test', status: 'pending' })])
    expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}/invitations/${carla.id}`)).status).toBe(204)
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/invitations`)).body).toEqual([])

    // Somebody else, signed in, is told it does not exist.
    const eve = await signUp('eve@cooper.test', 'Eve')
    expect(await call(eve.as, 'GET', `/workspaces/${acme.id}/members`)).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
    expect((await call(browser(), 'GET', '/workspaces')).status).toBe(401)
  })

  test('someone removed from a workspace leaves their cards unassigned, a moment later', async () => {
    const { ana, bob, acme } = await acmeWithBob()
    await settled()
    const card = (await welcomeOf(ana.as, acme.id)).cards[0]!
    expect((await call(ana.as, 'POST', `/workspaces/${acme.id}/cards/${card.id}/assign`, { assigneeId: bob.id })).body).toMatchObject({ assigneeId: bob.id })

    expect(await call(ana.as, 'DELETE', `/workspaces/${acme.id}/members/${ana.id}`)).toMatchObject({ status: 409 })
    expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}/members/${bob.id}`)).status).toBe(204)
    expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
    await settled()

    expect((await call<{ assigneeId: string | null }>(ana.as, 'GET', `/workspaces/${acme.id}/cards/${card.id}`)).body.assigneeId).toBeNull()
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/members`)).body).toEqual([expect.objectContaining({ id: ana.id })])
  })

  test('a deleted workspace loses its boards, and nobody enters it', async () => {
    const { ana, bob, acme } = await acmeWithBob()
    await settled()
    expect((await contexts.boards.modules.board.listOf(acme.id, { size: 10 })).total).toBe(1)

    expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}`)).status).toBe(204)
    await settled()

    expect(await contexts.boards.modules.board.listOf(acme.id, { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect(await contexts.boards.modules.card.countByWorkspace([acme.id])).toEqual([{ workspaceId: acme.id, cards: 0 }])
    expect((await call(ana.as, 'GET', '/workspaces')).body).toEqual([])
    expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
  })
})
```

- `testConfig` pone las dos bases de datos en memoria, y los servidores en puertos libres.
  `freePort` y `browser` vienen de `newt/testing`: un puerto en el que nadie escucha, y un
  `fetch` que envía `json` como cuerpo y guarda las cookies (el capítulo 22 las necesita).
  (`inWorkspace` se importa para un test que añade un capítulo posterior.)
- A boards se le dice quién envía cada petición con una cabecera `x-user`, como hace el
  servidor de desarrollo hasta el [capítulo 22](./22-web-session). `signUp` crea la cuenta
  por el módulo user de auth y da un navegador que envía la cabecera.
- `settled` espera a los jobs de auth, y luego a los de boards.
- `acmeWithBob` es toda la invitación, por HTTP: Ana crea Acme e invita a Bob, el email
  sale en `settled()`, un navegador sin nadie con sesión revisa el enlace, y Bob lo acepta.

Los cuatro tests: un workspace nuevo es de quien lo crea y recibe su tablero de bienvenida
un momento después; solo el admin lo gestiona, y a alguien de fuera se le dice que no
existe; a quien se quita se le dejan las tarjetas sin asignar; un workspace borrado pierde
sus tableros.

### Nadie en un workspace borrado

El último test de `open-contexts.test.ts` comprueba la segunda pregunta de `isMember`.
Importa `runAsActor` y `stopContexts`:

```ts
// cooper/backend/open-contexts.test.ts
import { runContexts } from 'newt/application'
import { runAsActor } from 'newt/core'
import { config, type Config } from './config'
import { openContexts, stopContexts } from './open-contexts'
```

y añade el test al final:

```ts
// cooper/backend/open-contexts.test.ts
test('lets no member into a deleted workspace whose accesses are not taken away yet', async () => {
  const contexts = await openContexts(testConfig())
  try {
    const { access, tenant, user } = contexts.auth.modules
    const signUp = (name: string) => user.signUp({ email: `${name.toLowerCase()}@cooper.test`, name, password: 'a long password' })
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id, via: 'web' }, fn)
    const acme = await asAna(() => tenant.create({ name: 'Acme' }))
    await asAna(() => access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await contexts.auth.base.jobs.idle()
    await contexts.auth.base.jobs.stop()

    // The second save of `delete` fails, and its worker does not run: the accesses stay.
    access.revokeTenant = async () => { throw new Error('the database went away') }
    await expect(asAna(() => tenant.delete(acme.id))).rejects.toThrow('the database went away')
    expect(await access.check(bob.id, 'cooper', acme.id)).not.toBeNull()

    const { member } = contexts.boards.modules
    await expect(runAsActor({ userId: bob.id, via: 'web' }, () => member.enter(acme.id))).rejects.toMatchObject({ code: 'workspace.not_found' })
    expect(await member.find(acme.id, bob.id)).toBeNull()
  } finally {
    await stopContexts(contexts)
  }
})
```

Detiene el worker de auth, y luego hace que `access.revokeTenant` lance un error, así que
`tenant.delete` guarda el tenant como borrado y falla con los accesos. El acceso de Bob
sigue ahí. boards no lo deja entrar en ningún sitio de todos modos: el tenant ya no está.

## Compruébalo

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

Los dos archivos de test nuevos por separado:

```sh
bun test cooper/backend/cooper.test.ts cooper/backend/open-contexts.test.ts
```

```text
 6 pass
 0 fail
 54 expect() calls
Ran 6 tests across 2 files.
```

Luego a mano. Tus bases de datos tienen lo que dejaron las comprobaciones de capítulos
anteriores: filas de boards para el `acme` del falso, y quizá una cuenta para
`ana@cooper.dev` con otra contraseña. Empieza con unas vacías, y luego haz el seed:

```sh
rm -f data/cooper-auth.db* data/cooper-boards.db*
bun run cooper:seed
```

Imprime los emails que envía (la invitación de Bob, y luego las tarjetas que se le
asignan), y termina con:

```text
cooper is seeded. Every account's password is
  cooper-demo

  ana@cooper.dev     Acme's admin, http://localhost:5172: its boards Welcome and Launch
  bob@cooper.dev     a member of Acme, who accepted Ana's invitation
```

Ejecútalo otra vez. No envía ningún email e imprime solo esa última parte: todo estaba ya.

Arranca el backend (`bun cooper/backend/index.ts`) y, en otra terminal, inicia sesión en
auth como Ana. Su respuesta es su cuenta:

```sh
ANA=$(curl -s -X POST localhost:3001/api/session/sign-in -H 'content-type: application/json' \
  -d '{"email":"ana@cooper.dev","password":"cooper-demo"}' | jq -r .id)
```

boards sigue tomando quién eres de `x-user`, ahora un id de usuario de verdad. Sus
workspaces:

```sh
curl -s localhost:3002/api/workspaces -H "x-user: $ANA" | jq .
```

```json
[
  {
    "id": "01a17961-b9a5-7779-8c29-7254b001bca5",
    "name": "Acme",
    "adminId": "01a17961-b959-7102-a717-5977838e302e",
    "isAdmin": true,
    "createdAt": "2026-10-26T18:03:30.086Z"
  }
]
```

Los tableros y los miembros de Acme:

```sh
ACME=$(curl -s localhost:3002/api/workspaces -H "x-user: $ANA" | jq -r '.[0].id')
curl -s localhost:3002/api/workspaces/$ACME/boards -H "x-user: $ANA" | jq '[.items[].name]'
curl -s localhost:3002/api/workspaces/$ACME/members -H "x-user: $ANA" | jq .
```

```json
[
  "Launch",
  "Welcome"
]
[
  {
    "id": "01a17961-b959-7102-a717-5977838e302e",
    "name": "Ana García",
    "email": "ana@cooper.dev",
    "isAdmin": true
  },
  {
    "id": "01a17961-b9a4-751c-95fd-f36b26bac3cf",
    "name": "Bob Smith",
    "email": "bob@cooper.dev",
    "isAdmin": false
  }
]
```

Tus ids y horas serán otros. Ahora Ana invita a Cai:

```sh
curl -s -X POST localhost:3002/api/workspaces/$ACME/invitations -H "x-user: $ANA" \
  -H 'content-type: application/json' -d '{"email":"cai@cooper.dev"}'
```

```json
{"id":"01a17962-516d-733c-a52d-ac8d75fc6cb5","email":"cai@cooper.dev","status":"pending","createdAt":"2026-10-26T18:04:08.942Z","expiresAt":"2026-11-02T18:04:08.941Z"}
```

Un momento después, la consola del servidor muestra el email, enviado por el worker de
auth:

```text
[mail] from cooper <no-reply@cooper.local> to cai@cooper.dev: Ana García invited you to Acme on Cooper
  Ana García invited you to join the workspace Acme on Cooper.

  Accept the invitation: http://localhost:5172/invitations/nQ_j9xI9Tdw0_eBzCqgmcKWf_KYimsA0z3CmEKL0ymc

  Sign in, or sign up, with cai@cooper.dev to accept it. It expires on 2026-11-02.
```

Su enlace, sin nadie con sesión:

```sh
curl -s localhost:3002/api/invitations/<the token from the email>
```

```json
{"workspaceName":"Acme","email":"cai@cooper.dev","invitedBy":"Ana García"}
```

Y a alguien de fuera de Acme que pide sus miembros se le dice que no existe (404):

```sh
curl -s localhost:3002/api/workspaces/$ACME/members -H 'x-user: someone'
```

```json
{"error":"There is no workspace 01a17961-b9a5-7779-8c29-7254b001bca5","code":"workspace.not_found"}
```

## Qué recordar

- Un contexto recibe de otro dos tipos de cosas: **puertos** en sus propias palabras, para
  sus propias reglas (los emisores de otro contexto encajan tal cual en un puerto de
  eventos), y un **`Pick` de los módulos del otro**, para lo que llama tal cual. Nunca su
  contexto, su base ni su store.
- Una suscripción al emisor de otro contexto es un **job del outbox de ese contexto**,
  ejecutado por su worker. Espera primero a sus jobs, y luego a los tuyos.
- **Las escrituras en otro contexto empiezan en una ruta**, un punto de entrada. Ningún caso
  de uso tuyo escribe en otro contexto; solo lo lee, y se entera del resto por eventos,
  desde un worker. Una llamada a otro contexto es como una API externa: después de lo que
  pueda fallar, y segura de repetir.
- `newt/context-boundaries` sujeta cada contexto a los que nombra su `uses`, nunca en
  ciclo. Todo archivo que lee el lint está en un proyecto de TypeScript.
- Un seed escribe por los casos de uso, como lo haría cualquiera, y busca lo que hay antes
  de escribir, así que se puede ejecutar dos veces. Un falso de otro contexto es solo para
  tests.

Siguiente: [Un servidor OAuth](./21-oauth-server).
