# Wiring contexts together

Since [chapter 4](./04-who-and-where), boards has asked a fake auth who belongs to
each workspace. In [chapter 13](./13-another-context) the fake learned to tell
`access.revoked`, and in [chapter 14](./14-sagas) to create and delete workspaces.
Meanwhile the real auth grew: accounts and sessions ([chapter 17](./17-auth)),
workspaces and access ([chapter 18](./18-tenants-and-access)), invitations
([chapter 19](./19-invitations-and-time)).

This chapter takes the fake out of the server. `openContexts` hands boards auth's
use cases and auth's emitters, and boards' ports, unchanged, now answer from auth.
boards also gets the routes its UI will call to make a workspace, invite someone,
and remove a member: entry points into auth, on boards' own origin. The lint learns
that boards may use auth, and nothing else across contexts. A seed script fills a
fresh database with a workspace to look at. FakeAuth stays, for boards' own tests.

## What boards asks of auth

boards gets two kinds of things from auth, and they are different on purpose.

- **Ports**, in boards' words: `workspaces` (who belongs to each one, from
  [chapter 4](./04-who-and-where)), `tenants` and `access` (auth's events, from
  chapters 13 and 14). boards' modules need them for their own rules, and a test
  hands its own.
- **auth's use cases**, as they are: who someone is (`user`), and what boards' routes
  for workspaces, members and invitations manage in auth (`tenant`, `access`,
  `invitation`). These are not ports. Those routes take and answer auth's own shapes;
  a port would only repeat auth's API one to one.

`Boards_Auth` says which of auth's modules boards may call. Today they are the four its
workspace module asks of auth, its `WorkspaceAuth` (in its deps, below), so
`Boards_Auth` is that type, named once, and the module is handed `deps.auth` whole.
Never auth's context, its base or its store: with only modules in hand, boards reaches
auth through its use cases and nothing else. If boards one day needs another of auth's
modules, the change shows in this type ([chapter 22](./22-web-session) adds one).

Replace `contexts/boards/initialize-modules.ts`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import { Board_Module } from './modules/board/board.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'
import type { TenantEvents, WorkspaceAuth } from './modules/workspace/workspace.deps'
import { Workspace_Module } from './modules/workspace/workspace.module'
import type { CardSearch } from './search/card-search'

/**
 * auth's use cases `boards` calls besides its ports: what its workspace module asks
 * of auth (who someone is, and what boards' routes for workspaces, members and
 * invitations manage in auth).
 */
export type Boards_Auth = WorkspaceAuth

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
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants, auth: deps.auth })
  const activity = Activity_Module.initialize(base, { card, member, tenants: deps.tenants }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

`Boards_ModuleDeps` gets `auth`, and the workspace module receives auth's four
modules. The other modules get nothing new: the card and member modules keep asking
through their ports.

Say the same in `boards.context.ts`. Replace its comment, and add one to `open`:

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

## Many users at once: `user.getMany`

The members' screen lists who belongs to a workspace: their accesses, and the users
they are for. One `user.get` per access would be a query each. Add `getMany` to auth's
`user.module.ts`, after `get`:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
  /** For other modules and contexts: the ones with these ids, in no order; an id of none is not there. */
  @UseCase()
  async getMany(ids: string[]): Promise<UserDTO[]> {
    if (ids.length === 0) return []
    return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(user => user.toDTO())
  }
```

It answers the users it finds, in no order. A caller that wants them by id makes a
`Map`, as you will see.

## boards on auth: `boardsOnAuth`

`openContexts` opens auth first, then boards, and wires boards' ports to auth. Replace
`open-contexts.ts`:

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

FakeAuth is gone from this file. `boardsOnAuth` is where boards' words become auth's:

- **A workspace is a tenant of the product `cooper`**: `WORKSPACES_PRODUCT`, which
  auth declares next to its products ([chapter 18](./18-tenants-and-access)). It is
  a constant, not a module: importing it gives boards no way into auth's data.
- **`exists`**, which a worker of boards asks before writing in a workspace that may
  be gone ([chapter 14](./14-sagas)), is `tenant.getMany`, which leaves deleted
  tenants out.
- **`isMember`** asks both `access.check` and `exists`. Deleting a workspace saves
  the tenant, then takes its accesses away in a second save
  ([chapter 18](./18-tenants-and-access)). Between the two, or if the second fails
  and its worker has not run yet, the accesses are still there. Asking whether the
  tenant exists too keeps everyone out from the moment it is deleted. A test below
  makes the second save fail and checks it.
- **`member`** is `isMember`, then the user.
- **`tenants` and `access`** are auth's emitters, `tenant.events` and `access.events`.
  A port only asks for `subscribe`, and an emitter has it: they fit as they are.

### Whose worker runs which job

A `handler`'s job is written in the store of the save that tells the event
([chapter 13](./13-another-context)). boards subscribes on auth's emitters, so its
reactions to auth's events are **jobs of auth's outbox, run by auth's worker**:

| Job | Outbox | Run by |
|---|---|---|
| `workspace.prepare.on.tenant.created` | auth's | auth's worker |
| `workspace.purge.on.tenant.deleted` | auth's | auth's worker |
| `activity.purgeWorkspace.on.tenant.deleted` | auth's | auth's worker |
| `card.unassignMember.on.access.revoked` | auth's | auth's worker |
| `card.notifyAssignee`, `card.indexCard`, `activity.record…`, … | boards' | boards' worker |

`workspace.prepare` runs in auth's worker and writes boards' board, columns and card,
in boards' store. Those saves tell `card.created` and the rest, whose jobs go to
boards' outbox. So whoever waits for the background work waits for auth's jobs
first, then boards'. The test and the seed below do exactly that.

FakeAuth did the same from its own store, so nothing in boards changes: it was
written for this from chapter 13.

### The product, by its name

In [chapter 13](./13-another-context) the cards' reaction to `access.revoked` named
the product `'cooper'` by hand, waiting for auth's constant. Use it now. In
`card.workers.ts`, import it:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
import { WORKSPACES_PRODUCT } from '../../../auth/modules/product/product.schema'
import type { CardAuthor, CardDTO } from './card.schema'
```

and replace the subscription on `access.revoked`, dropping the comment line that said
"For now":

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
  // auth took someone's access to a workspace: their cards there are left unassigned.
  // auth tells every access it takes away, to any product: only a workspace's is boards'.
  // A card checks its assignee before its save, so they may leave in between: a card
  // created for someone, or given to them, looks again once saved, the same way.
  deps.access.revoked.subscribe(access => cards.unassignMember(access.tenantId, access.userId), {
    strategy: 'handler',
    queue: 'card.unassignMember.on.access.revoked',
    when: (access: RevokedAccess): access is RevokedAccess & { tenantId: string } => access.productId === WORKSPACES_PRODUCT && access.tenantId !== null,
  })
```

## Workspaces, members and invitations, through boards

People manage their workspaces from boards' UI: they make one, rename it, invite
someone, remove someone. All of that is auth's. But the UI lives on boards' origin,
with boards' session ([chapter 22](./22-web-session)). So boards has routes for them,
and each route calls auth's use case.

### The deps

The workspace module gets auth's modules. Replace
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

`WorkspaceAuth` names the four modules by their classes, in the module's own deps, as
every module writes what it is given. `Boards_Auth` above is this type.

### The shapes boards answers with

auth's tenants, accesses and invitations, in boards' words. Add to
`modules/workspace/workspace.schema.ts` two imports at the top:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.schema.ts
import { Email } from 'newt/contract'
import { z } from 'zod'
import type { BoardDTO } from '../board/board.schema'
```

and, after `WELCOME_BOARD`, the schemas and two functions that make them:

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

`workspaceOf` answers whether the person looking is the admin, so the UI knows which
buttons to show. `workspaceInvitationOf` copies only the fields the admin is shown:
auth's DTO has more (who invited, who accepted), and an object with extra fields
still fits the type, so the function picks them by hand.

### Reading auth: `mine` and `members`

Two use cases of boards read auth, to put together what its screens show. In
`workspace.module.ts`, replace the imports:

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

and add them after `boardView`:

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

`allPages` ([chapter 16](./16-search-port)) reads every page of a paged use case
into one array. It works the same on another context's use cases: `listForUser`
takes a `PageRequest` and answers a `Page`, as boards' own do. Use it for what the
screen shows whole anyway: someone's workspaces, a workspace's members. Then each
use case asks for every tenant, or every user, in one call, and joins them by id.

Both only read. A use case of boards calling auth's use case is calling another
context's API: auth's `listForUser` runs as the root of what it does in auth, under
auth's rules, as if someone outside had called it.

### The routes: entry points into auth

Replace `modules/workspace/workspace.routes.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
import { allPages, currentActor } from 'newt/core'
import { WORKSPACES_PRODUCT } from '../../../auth/modules/product/product.schema'
import { InvitationNotOpen } from '../../../auth/modules/invitation/errors/invitation-not-open'
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
    const created = await tenant.create(await request.json())
    return Response.json(workspaceOf(created, currentActor().userId), { status: 201 })
  })

  // The rest is about one workspace: a member's (404 for anyone else), and auth checks the admin.
  workspace.patch('', async request => {
    const renamed = await tenant.rename(request.params.workspaceId, await request.json())
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
    const created = await invitation.create(request.params.workspaceId, await request.json())
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

- `GET /workspaces` and `POST /workspaces` are on `base.http`: no workspace in the
  path yet. A signed-in person makes one with `tenant.create`, and is its admin.
- `PATCH` and `DELETE` on the workspace, its members and its invitations are on
  `workspace` ([chapter 4](./04-who-and-where)): only a member gets past it, anyone
  else gets a 404. auth checks the admin.
- `DELETE /members/:userId` is `access.revoke`: the admin removes someone, or a
  member leaves. The cards' reaction ([chapter 13](./13-another-context)) unassigns
  their cards a moment later.
- `GET /invitations/:token` is **public**: Bob opens his link before signing in. It
  answers only what the page needs, and a link that opens nothing says so with
  `invitation.not_open`.
- `POST /invitations/:token/accept` needs someone signed in, and auth checks that it
  is the invited email.
- Each route passes the body as it came, `await request.json()`: `tenant.create`,
  `tenant.rename` and `invitation.create` take `input: unknown` and parse it
  (chapters 18 and 19), so the routes import none of auth's schemas.

A route is not a use case. It is an adapter, like auth's own routes, so what it
calls in auth is the root of what auth does: `tenant.create` writes the tenant and
the admin's access under its own `writesTo`, and the write rule holds inside auth as
always. The request runs as the person signed in to boards, so auth's
`currentActor()` is them.

Why not a use case of boards, say `workspace.create`, that calls `tenant.create`?
newt would allow it. But then a use case of boards would write in two stores. If it
did anything in boards after the call and that failed, auth's part would stay and
nobody would finish boards'. cooper keeps a simpler rule:

> **No use case of boards writes into auth.** boards' use cases only read auth
> (`mine`, `members`). Writes into auth start at a route. boards hears what auth did
> through its events, from a worker: a new workspace's welcome board.

Calling another context is like calling an external API, such as a payment
provider: what it saved stays saved, whatever your side does next. Call it after
whatever can fail on your side, and make the call safe to repeat.

## FakeAuth stays, for boards' tests

boards' own tests still open boards alone, with FakeAuth behind its ports. They never
reach auth's use cases: the routes that do are tested on the real auth, in cooper's
test below. But `Boards_ModuleDeps` now wants `auth`. FakeAuth hands an object that
fails, saying so, if anything calls it. In `testing/fake-auth.ts`, import the type:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
import { Base } from 'newt/runtime'
import type { Boards_Auth } from '../initialize-modules'
import type { AccessEvents } from '../modules/card/card.deps'
```

and add `modules` after `access`:

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

Any `auth.<module>.<useCase>` is a function that rejects with that message. In
`testing/open-test-boards.ts`, hand it:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
    access: auth.access,
    auth: auth.modules,
    mailer,
```

FakeAuth is now only in `testing/`, and only `openTestBoards` opens it.

## The lint: boards uses auth

boards' files now import auth's: `workspace.deps.ts` names auth's module classes,
`card.workers.ts` and `workspace.routes.ts` import `WORKSPACES_PRODUCT`, and the
routes one of auth's errors. Since [chapter 17](./17-auth) the lint said `boards: []`, and it says no:

```text
cooper/backend/contexts/boards/modules/workspace/workspace.deps.ts
  2:36  error  '../../../auth/modules/access/access.module' is the context auth's, and boards uses no other context: contexts use only the ones they say, never in a cycle          newt/context-boundaries
  3:40  error  '../../../auth/modules/invitation/invitation.module' is the context auth's, and boards uses no other context: contexts use only the ones they say, never in a cycle  newt/context-boundaries
  …
```

`newt/context-boundaries` reads where each import lands: a file in a context's folder
imports only the contexts that context `uses`. `uses` names every context, and must
be a tree: `auth: ['boards']` next to `boards: ['auth']` would be a cycle, and the
preset throws when it is built. So auth can never import boards, and boards hears
auth only through ports, events and the use cases it is handed.

Say that boards uses auth, and lint the scripts too (the seed comes next). In
`eslint.config.js`:

```js
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'] } },
})
```

`cooper/AGENTS.md` says it too, for the coding agents. Change boards' line in its
`## Contexts`:

```md
- boards: the boards of each workspace, their columns and cards. Uses auth.
```

The preset's lint uses type information (it refuses a promise left unawaited), so
every file it lints must be in a TypeScript project. The scripts are not part of the
backend: create a project for them, `tsconfig.node.json`, at the root:

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

and reference it from the root `tsconfig.json`:

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

## A seed

With auth real, a fresh database has nobody in it, and every by-hand check would
start by signing up, making a workspace and inviting someone. A seed script does it
once. It opens the contexts with `openContexts`, as the server does, and writes
through their use cases, as anyone would: no SQL, no rows by hand, so every rule and
every event holds. Create `cooper/scripts/seed.ts`:

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

- Its mailer keeps every email, and also writes it to the console. The seed reads
  Bob's link from the email Ana's invitation sends, and accepts it as Bob: the same
  path a person takes.
- `settled` waits for auth's jobs, then boards'. Acme's welcome board is made by
  auth's worker, on `tenant.created`.
- Each step looks first: `account` finds the email before signing up, Acme is found
  among Ana's tenants, Bob is invited only if he is not a member, and an invitation
  pending from an earlier run sends its link again (the first link's token was never
  kept). "Launch" is made only if Ana's workspace has no board by that name. Run it
  twice and the second run changes nothing.
- It runs as Ana with `runAsActor`, and in Acme with `inWorkspace`
  ([chapter 4](./04-who-and-where)), as a request to boards would.
- It stops the contexts at the end, whatever happens.

Add the script to the root `package.json`, after `docs:build`:

```json
    "docs:build": "vitepress build web",
    "cooper:seed": "bun run cooper/scripts/seed.ts"
```

## Tests

### cooper end to end

boards' own tests use FakeAuth; auth's use only auth. Neither sees the two together.
Create `cooper/backend/cooper.test.ts`, which opens both as the server does, on
SQLite in memory, and calls boards over HTTP as its UI will:

```ts
// cooper/backend/cooper.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
import { browser, freePort, type Browser } from 'newt/testing'
import { config, type Config } from './config'
import { openContexts, stopContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'
import { RecordingMailer } from './shared/mail/recording-mailer'

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
  const mailer = new RecordingMailer()
  mails = mailer.mails
  contexts = await openContexts(testConfig(freePort(), freePort()), { mailer })
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

- `testConfig` puts both databases in memory, and the servers on free ports.
  `freePort` and `browser` come from `newt/testing`: a port nobody listens on, and a
  `fetch` that sends `json` as the body and keeps cookies (chapter 22 needs them).
  The emails go to a `RecordingMailer` ([chapter 12](./12-failures)), whose `mails`
  the tests read.
- boards is told who sends each request by an `x-user` header, as the dev server
  does until [chapter 22](./22-web-session). `signUp` makes the account through
  auth's user module and gives a browser that sends the header.
- `settled` waits for auth's jobs, then boards'.
- `acmeWithBob` is the whole invitation, over HTTP: Ana makes Acme and invites Bob,
  the email leaves on `settled()`, a browser with no one signed in reviews the link,
  and Bob accepts it.

The four tests: a new workspace is its maker's and gets its welcome board a moment
later; only the admin manages it, and someone outside is told it does not exist;
someone removed has their cards unassigned; a deleted workspace loses its boards.

### Nobody in a deleted workspace

The last test in `open-contexts.test.ts` checks `isMember`'s second question. Import
`runAsActor` and `stopContexts`:

```ts
// cooper/backend/open-contexts.test.ts
import { runContexts } from 'newt/application'
import { runAsActor } from 'newt/core'
import { config, type Config } from './config'
import { openContexts, stopContexts } from './open-contexts'
```

and add the test at the end:

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

It stops auth's worker, then makes `access.revokeTenant` throw, so `tenant.delete`
saves the tenant as deleted and fails on the accesses. Bob's access is still there.
boards lets him in nowhere anyway: the tenant is gone.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 103 pass
 0 fail
```

The two new test files on their own:

```sh
bun test cooper/backend/cooper.test.ts cooper/backend/open-contexts.test.ts
```

```text
 6 pass
 0 fail
 54 expect() calls
Ran 6 tests across 2 files.
```

Then by hand. Your databases have what earlier chapters' checks left: boards' rows
for the fake's `acme`, and maybe an account for `ana@cooper.dev` with another
password. Start from empty ones, then seed:

```sh
rm -f data/cooper-auth.db* data/cooper-boards.db*
bun run cooper:seed
```

It prints the emails it sends (Bob's invitation, then the cards assigned to him),
and ends with:

```text
cooper is seeded. Every account's password is
  cooper-demo

  ana@cooper.dev     Acme's admin, http://localhost:5172: its boards Welcome and Launch
  bob@cooper.dev     a member of Acme, who accepted Ana's invitation
```

Run it again. It sends no email and prints only that last part: everything was there.

Start the backend (`bun cooper/backend/index.ts`) and, in another terminal, sign in
to auth as Ana. Its answer is her account:

```sh
ANA=$(curl -s -X POST localhost:3001/api/session/sign-in -H 'content-type: application/json' \
  -d '{"email":"ana@cooper.dev","password":"cooper-demo"}' | jq -r .id)
```

boards still takes who you are from `x-user`, now a real user id. Her workspaces:

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

Acme's boards and members:

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

Your ids and times differ. Now Ana invites Cai:

```sh
curl -s -X POST localhost:3002/api/workspaces/$ACME/invitations -H "x-user: $ANA" \
  -H 'content-type: application/json' -d '{"email":"cai@cooper.dev"}'
```

```json
{"id":"01a17962-516d-733c-a52d-ac8d75fc6cb5","email":"cai@cooper.dev","status":"pending","createdAt":"2026-10-26T18:04:08.942Z","expiresAt":"2026-11-02T18:04:08.941Z"}
```

A moment later, the server's console shows the email, sent by auth's worker:

```text
[mail] from cooper <no-reply@cooper.local> to cai@cooper.dev: Ana García invited you to Acme on Cooper
  Ana García invited you to join the workspace Acme on Cooper.

  Accept the invitation: http://localhost:5172/invitations/nQ_j9xI9Tdw0_eBzCqgmcKWf_KYimsA0z3CmEKL0ymc

  Sign in, or sign up, with cai@cooper.dev to accept it. It expires on 2026-11-02.
```

Its link, with no one signed in:

```sh
curl -s localhost:3002/api/invitations/<the token from the email>
```

```json
{"workspaceName":"Acme","email":"cai@cooper.dev","invitedBy":"Ana García"}
```

And someone outside Acme asking for its members is told it does not exist (404):

```sh
curl -s localhost:3002/api/workspaces/$ACME/members -H 'x-user: someone'
```

```json
{"error":"There is no workspace 01a17961-b9a5-7779-8c29-7254b001bca5","code":"workspace.not_found"}
```

## What to remember

- A context gets two kinds of things from another: **ports** in its own words, for
  its own rules (another context's emitters fit an event port as they are), and a
  **type naming the other's modules** it calls as they are. Never its context, its
  base or its store.
- A subscription on another context's emitter is a **job of that context's outbox**,
  run by its worker. Wait for its jobs first, then your own.
- **Writes into another context start at a route**, an entry point. No use case of
  yours writes into another context; it only reads it, and hears the rest through
  events, from a worker. A call into another context is like an external API: after
  what can fail, and safe to repeat.
- `newt/context-boundaries` holds each context to the ones its `uses` names, never
  in a cycle. Every file the lint reads is in a TypeScript project.
- A seed writes through the use cases, as anyone would, and finds what is there
  before writing, so it runs twice. A fake of another context belongs to tests only.

Next: [An OAuth server](./21-oauth-server).
