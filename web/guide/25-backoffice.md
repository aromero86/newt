# A third context that reads two

cooper's staff work for the company that runs it. They need a console of their own:
every workspace, every account, who is of the staff, and later a few numbers and the
jobs that failed. None of that belongs to a workspace, and none of it is new data.
auth keeps the accounts and the workspaces; boards keeps what is in them.

This chapter builds `backoffice`, the third context. It keeps almost nothing: only
the web sessions of the staff signed in to it. Each screen is put together from the
use cases of the contexts that know. Four things are new:

- **A context that uses two.** The lint says `backoffice: ['auth', 'boards']`, and
  the backoffice is handed a `Pick` of each one's modules: their use cases, never a
  base nor a store.
- **One check in front of every route.** A group with prefix `''` whose middleware
  asks `staff.enter`: 401 to nobody, 403 to anyone who is not of the staff, at once
  after their access is taken away.
- **Reading other contexts through their use cases**, a page at a time, a handful of
  calls per page and never one per row.
- **Signing in through auth's OAuth, as boards does**: the web session of [chapter
  22](./22-web-session), as the OAuth client `backoffice`.

The backoffice's frontend waits for [chapter 26](./26-dead-jobs-and-analytics): its
overview and its jobs page read two modules that chapter adds. Until then the
backoffice is its API, and its tests check it, signing in through auth end to end.

## Its settings

The backoffice is opened like the others: a port, a database, where people open it,
where they sign in, its OAuth client's secret. auth has named the backoffice since
[chapter 17](./17-auth): `publicUrls.backoffice` and `clientSecrets.backoffice` are
in `config.ts` already, and auth declared the product `backoffice`, with its OAuth
client, in [chapter 21](./21-oauth-server). Add the backoffice's part to `config`,
after `boards`:

```ts
// cooper/backend/config.ts
// …
    /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND ?? 'dist/cooper/boards'),
  },
  /** The staff's console. */
  backoffice: {
    /** Where it listens (`COOPER_BACKOFFICE_PORT`). */
    port: ports.backoffice,
    /** `COOPER_BACKOFFICE_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_BACKOFFICE_DATABASE ?? 'data/cooper-backoffice.db'),
    publicUrl: publicUrls.backoffice,
    /** Where the staff sign in. */
    authPublicUrl: publicUrls.auth,
    /** Its OAuth client's secret: the product `backoffice` in auth. */
    clientSecret: clientSecrets.backoffice,
    sessionDays,
    /** `COOPER_BACKOFFICE_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BACKOFFICE_FRONTEND ?? 'dist/cooper/backoffice'),
  },
// …
```

and its type, in a new folder `contexts/backoffice`:

```ts
// cooper/backend/contexts/backoffice/backoffice-config.ts
import type { Config } from '../../config'

/** The settings of `backoffice`, from `config.ts`. */
export type Backoffice_Config = Config['backoffice']
```

## Its database: only the sessions

The web session keeps its sessions in the context's own database. In [chapter
22](./22-web-session) boards copied `shared/web-session`'s migration into its own
folder. The backoffice does the same; it has no other table, so it is its first
migration:

```sql
-- cooper/backend/contexts/backoffice/migrations/sqlite/00001_session_up.sql
-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user_id ON session (user_id);
```

```sql
-- cooper/backend/contexts/backoffice/migrations/sqlite/00001_session_down.sql
DROP TABLE session;
```

## The staff

In auth, an access says who may enter which product, for which tenant ([chapter
18](./18-tenants-and-access)). A member of Acme has access to the product `cooper`
for the tenant Acme. Someone of the staff has access to the product `backoffice` for
**no tenant**: `tenantId` is `null`. The staff look at all of cooper, not at one
workspace.

So the backoffice does not keep who the staff are. auth does. The backoffice's `staff`
module asks auth every time, and gives or takes the access away through auth's own
use cases.

### Its errors

Three errors, in `modules/staff/errors/`. The first one is the one every route can
answer:

```ts
// cooper/backend/contexts/backoffice/modules/staff/errors/not-staff.ts
import { ForbiddenError } from 'newt/core'

/**
 * Someone signed in who is not of the staff (any more). A 403, not a 404: the
 * backoffice is no secret to whoever signed in to it, and refusing them says nothing
 * of any workspace or account. What is inside is answered as usual: a workspace that
 * does not exist is a 404.
 */
export class NotStaff extends ForbiddenError {
  readonly code = 'staff.not_staff'
  constructor() {
    super('Only Cooper\'s staff may use the backoffice')
  }
}
```

In boards, a workspace you do not belong to is a 404: a 403 would tell a stranger that
the workspace exists. The backoffice answers 403, and says why. It can: the 403 comes
before anything is read, for every path, so it gives away nothing about which
workspaces or accounts exist. And whoever gets it signed in to the backoffice, so the
backoffice is no secret to them.

The other two are about granting and revoking:

```ts
// cooper/backend/contexts/backoffice/modules/staff/errors/own-access-not-revocable.ts
import { ForbiddenError } from 'newt/core'

/** Someone of the staff taking their own access away: another one does it, so the backoffice is never left without staff. */
export class OwnAccessNotRevocable extends ForbiddenError {
  readonly code = 'staff.own_access_not_revocable'
  constructor() {
    super('You cannot take away your own access: someone else of the staff can')
  }
}
```

```ts
// cooper/backend/contexts/backoffice/modules/staff/errors/staff-account-not-found.ts
import { NotFoundError } from 'newt/core'

/** Nobody has an account with the email given: they sign up in auth first. */
export class StaffAccountNotFound extends NotFoundError {
  readonly code = 'staff.account_not_found'
  constructor(email: string) {
    super(`No account has the email ${email}: they sign up first`)
  }
}
```

### What it is given

The module's options say which product is the backoffice. It is auth's name for it,
and the context passes it in:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff-options.ts
/** What the context configures the staff with. */
export type Staff_Options = {
  /** The backoffice as a product of auth's: its staff have access to it for no tenant. */
  productId: string
}
```

Its deps are two of auth's modules, by their classes, grouped under `auth`, as boards'
modules group auth's since [chapter 20](./20-wiring-contexts):

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.deps.ts
import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { User_Module } from '../../../auth/modules/user/user.module'

/** auth's modules, called through their use cases: auth keeps who the staff are. */
export interface Staff_Deps {
  auth: {
    /** The accounts: who someone of the staff is, and whose an email is. */
    user: User_Module
    /** Who may enter the backoffice, asked every time; and giving or taking that away. */
    access: Access_Module
  }
}
```

The backoffice has a `user` module of its own (below). Under `auth` there is no doubt
whose is whose: auth's is `this.deps.auth.user`. Every module of the backoffice groups
what it uses of the other contexts the same way, `auth: { … }` and `boards: { … }`.

### Its shapes

Someone becomes staff by the email of their account. A staff member, as the list
shows them, is their account and the date of their access:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.schema.ts
import { z } from 'zod'
import type { UserDTO } from '../../../auth/modules/user/user.schema'

/** Someone becomes staff by the email of their account, which they made in auth first. */
export const StaffGrantSchema = z.object({
  email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
})

/**
 * Someone of the staff: their account, and since when they may enter the backoffice.
 * Its `id` is their access's, by which the list goes page after page.
 */
export type StaffMemberDTO = {
  id: string
  userId: string
  name: UserDTO['name']
  email: UserDTO['email']
  since: string
}

export type StaffGrantDTO = z.input<typeof StaffGrantSchema>
```

The DTO's `id` is the access's, not the user's: the list goes page after page by the
access's id (`listForProduct` pages accesses), so that is the id a cursor names.
`name` and `email` take their types from auth's `UserDTO`: if auth changes them, this
breaks at compile time, not at run time.

### One check in front of every route: `staffRoutes`

Every route of the backoffice's API must check that the person signed in is of the
staff, and no route may forget. In [chapter 4](./04-who-and-where) boards solved the
same problem for workspaces with a group: `http.group(prefix, middleware)` returns a
router whose middleware runs around each of its routes, after the session is
checked. Do the same here, at the backoffice's root:

```ts
// cooper/backend/contexts/backoffice/staff-routes.ts
import type { CooperBase } from '../../shared/cooper-base'
import type { Staff_Module } from './modules/staff/staff.module'

/**
 * The routes of the backoffice's API: each one runs once `staff.enter` has checked the
 * signed-in person is of the staff now (403 for anyone else). auth already refused
 * anyone else at signing in (the product's access is `granted`); this counts an
 * access taken away since, at once. Every module of the backoffice registers its
 * routes on it.
 */
export function staffRoutes(base: CooperBase, staff: Staff_Module) {
  return base.http.group('', async (_request, next) => {
    await staff.enter()
    return next()
  })
}
```

The prefix is `''`: the backoffice has no scope like boards' workspace, so its group
adds no path, only the check. The middleware awaits `staff.enter()`, which throws
`NotStaff` for anyone else, and the router answers it as it answers any domain error.
No use case below has to check again, and no route can forget to.

Each module calls `staffRoutes` and registers its routes on what it returns. Each call
makes a group of its own with the same middleware; that is all a group is.

The answers follow from who asks:

| Who asks | Status | Why |
|---|---|---|
| Nobody signed in | 401 | The router refuses every route that is not `public`, before the middleware. |
| Someone signed in, not of the staff | 403 | `staff.enter` throws `NotStaff`, a `ForbiddenError`. |
| The staff, for something that is not there | 404 | A workspace or account that does not exist. |

Now the staff's own routes: list them, grant by email, revoke by user id:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Staff_Module } from './staff.module'

export function registerStaffRoutes(base: CooperBase, staff: Staff_Module): void {
  const routes = staffRoutes(base, staff)

  routes.get('/staff', async request => Response.json(await staff.list(pageRequestFrom(request))))

  routes.post('/staff', async request => Response.json(await staff.grant(await request.json()), { status: 201 }))

  routes.delete('/staff/:userId', async request => {
    await staff.revoke(request.params.userId)
    return new Response(null, { status: 204 })
  })
}
```

### The module

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.module.ts
import { currentActor, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import { NotStaff } from './errors/not-staff'
import { OwnAccessNotRevocable } from './errors/own-access-not-revocable'
import { StaffAccountNotFound } from './errors/staff-account-not-found'
import type { Staff_Deps } from './staff.deps'
import type { Staff_Options } from './staff-options'
import { registerStaffRoutes } from './staff.routes'
import { StaffGrantSchema, type StaffMemberDTO } from './staff.schema'

/**
 * Who the staff are: whoever has access to the backoffice for no tenant, as auth keeps
 * it. It keeps nothing: it asks auth every time, so an access taken away
 * counts at once, and gives or takes it away through auth's own use cases.
 */
export class Staff_Module extends Module {

  static initialize(base: CooperBase, deps: Staff_Deps, options: Staff_Options): Staff_Module {
    const module = new Staff_Module(base, deps, options)
    registerStaffRoutes(base, module)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: Staff_Deps, private readonly options: Staff_Options) {
    super('staff', base.invocations, deps)
  }

  /**
   * The signed-in person is of the staff, or nothing of the backoffice answers them:
   * what every route of its API checks first (`staffRoutes`).
   */
  @UseCase()
  async enter(): Promise<void> {
    if (!await this.isStaff(currentActor().userId)) throw new NotStaff()
  }

  /** The signed-in person, if they are of the staff: what the backoffice's session says it is. */
  @UseCase()
  async me(): Promise<UserDTO> {
    await this.enter()
    return this.deps.auth.user.get(currentActor().userId)
  }

  @UseCase()
  async isStaff(userId: string): Promise<boolean> {
    return (await this.deps.auth.access.check(userId, this.options.productId, null)) !== null
  }

  /** The staff, the oldest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<StaffMemberDTO>> {
    const accesses = await this.deps.auth.access.listForProduct(this.options.productId, page)
    const users = new Map((await this.deps.auth.user.getMany(accesses.items.map(access => access.userId))).map(user => [user.id, user]))
    return mapPage(accesses, access => {
      const user = users.get(access.userId)
      return user && { id: access.id, userId: user.id, name: user.name, email: user.email, since: access.createdAt }
    })
  }

  /**
   * Someone with an account becomes staff: auth gives them the access, as the
   * signed-in person (auth checks they are staff too). Given twice, it is given once.
   */
  @UseCase()
  async grant(input: unknown): Promise<StaffMemberDTO> {
    const { email } = StaffGrantSchema.parse(input)
    const user = await this.deps.auth.user.findByEmail(email)
    if (!user) throw new StaffAccountNotFound(email)
    const access = await this.deps.auth.access.grant({ userId: user.id, productId: this.options.productId, tenantId: null })
    return { id: access.id, userId: user.id, name: user.name, email: user.email, since: access.createdAt }
  }

  /** Someone leaves the staff: from then on, the backoffice refuses them. Never oneself. */
  @UseCase()
  async revoke(userId: string): Promise<void> {
    if (userId === currentActor().userId) throw new OwnAccessNotRevocable()
    await this.deps.auth.access.revoke({ userId, productId: this.options.productId, tenantId: null })
  }
}
```

- **`enter`** is the check `staffRoutes` runs. It asks auth (`isStaff`, which is
  `access.check` for the product and no tenant) on every request. Nothing is cached,
  so an access taken away counts at the next request, not when a session ends.
- **`me`** is the signed-in person, if they are staff. The web session answers it for
  `GET /api/session` (below), so that route is checked too.
- **`list`** pages auth's accesses to the product, then asks auth for the accounts of
  the whole page at once, with `user.getMany` ([chapter 20](./20-wiring-contexts)):
  two calls per page, never one per row. `mapPage` from `newt/core` maps each item and
  drops the ones that map to nothing (an account gone since).
- **`grant`** takes `input: unknown`, the body as the route got it, and parses it with
  `StaffGrantSchema`. It finds the account by email (`user.findByEmail`) and asks auth
  to grant the access. An email without an account is `StaffAccountNotFound`: the staff do not
  sign up through the backoffice's product, they sign up first and are granted after.
- **`revoke`** asks auth to take it away, but never one's own: someone else does it,
  so the backoffice is never left without staff.

### Writing into auth

`grant` and `revoke` change auth's data. Is that allowed? [Chapter
20](./20-wiring-contexts) kept a rule for boards: no use case of boards writes into
auth. The reason was a use case that writes in two stores, with nothing to finish the
second save if it failed after the first.

`staff.grant` writes in one store. It writes nothing in the backoffice: its only write
is auth's `access.grant`, one save in auth's store. There is no second save to leave
halfway.

And newt's write rule ([chapter 13](./13-another-context)) holds where it should. A use
case called from another context is that context's API, as an outside caller would be:
`access.grant` is the root of what happens in auth, and auth's own rules apply. Here
they matter: `access.grant` checks that the person signed in manages the product, that
is, that they are staff themselves. auth does not trust the backoffice. A test below
proves it: someone who is not of the staff calling `staff.grant` gets auth's 403.

The rule for a context that reads others, then: **read through their use cases, write
through their use cases, and keep each write one save in one store.** A write in your
own store that follows from theirs comes from a worker reacting to their event.

## Accounts

The staff look accounts up: all of them, newest first, or by email or name. The `user`
module of the backoffice keeps none; it shows auth's.

Its option names the product whose tenants are the workspaces, to count someone's
workspaces:

```ts
// cooper/backend/contexts/backoffice/modules/user/user-options.ts
/** What the context configures the accounts with. */
export type User_Options = {
  /** The product whose tenants are the workspaces: boards, `cooper` in auth. */
  workspacesProduct: string
}
```

```ts
// cooper/backend/contexts/backoffice/modules/user/user.deps.ts
import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module } from '../../../auth/modules/user/user.module'
import type { Staff_Module } from '../staff/staff.module'

export interface User_Deps {
  /** That who asks is of the staff, before any route answers; and whether an account is. */
  staff: Staff_Module
  auth: {
    /** auth's accounts, which this module shows: it keeps none. */
    user: User_Module
    /** The workspaces someone may enter. */
    access: Access_Module
    /** Those workspaces' names. */
    tenant: Tenant_Module
  }
}
```

`staff` is there for the routes (`staffRoutes` takes it) and to mark which accounts
are staff.

The shapes. What the staff search with is checked like any input. The answers are
auth's `UserDTO` with what the backoffice adds:

```ts
// cooper/backend/contexts/backoffice/modules/user/user.schema.ts
import { z } from 'zod'
import type { AccessRole } from '../../../auth/modules/access/access.schema'
import type { UserDTO } from '../../../auth/modules/user/user.schema'

/** How the staff look accounts up: an email or a name, whole, whatever its case. */
export const UserSearchSchema = z.object({
  text: z.string().trim().max(254).optional(),
})

/** Who someone is, beside what the staff look at: a workspace's admin, a member. */
export type PersonDTO = Pick<UserDTO, 'id' | 'name' | 'email'>

/** An account in the staff's list: whether it is of the staff too. */
export type UserSummaryDTO = UserDTO & {
  staff: boolean
}

/** An account, as the staff see it: whether it is of the staff, and how many workspaces it is in. */
export type UserDetailDTO = UserDTO & {
  staff: boolean
  workspaces: number
}

/** A workspace someone belongs to: its `id` is their access's, by which the list goes page after page. */
export type UserWorkspaceDTO = {
  id: string
  workspaceId: string
  name: string
  role: AccessRole
  since: string
}

export type UserSearchDTO = z.input<typeof UserSearchSchema>
export type { UserDTO }
```

`PersonDTO` is who someone is next to what the staff look at: a workspace's admin, a
member. The workspace module uses it too.

The routes. A search text comes in the query string:

```ts
// cooper/backend/contexts/backoffice/modules/user/user.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { User_Deps } from './user.deps'
import type { User_Module } from './user.module'

export function registerUserRoutes(base: CooperBase, users: User_Module, deps: User_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `?text=ana@cooper.dev`: an email or a name, whole.
  routes.get('/users', async request => {
    const text = new URL(request.url).searchParams.get('text') || undefined
    return Response.json(await users.list({ text }, pageRequestFrom(request)))
  })

  routes.get('/users/:userId', async request => Response.json(await users.get(request.params.userId)))

  routes.get('/users/:userId/workspaces', async request => Response.json(await users.workspaces(request.params.userId, pageRequestFrom(request))))
}
```

And the module:

```ts
// cooper/backend/contexts/backoffice/modules/user/user.module.ts
import { mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { UserFilterDTO } from '../../../auth/modules/user/user.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { User_Deps } from './user.deps'
import type { User_Options } from './user-options'
import { registerUserRoutes } from './user.routes'
import { UserSearchSchema, type UserDetailDTO, type UserSearchDTO, type UserSummaryDTO, type UserWorkspaceDTO } from './user.schema'

/**
 * cooper's accounts, as the staff look them up. auth keeps them; this module only
 * reads, through auth's use cases, and puts together what one screen shows
 * (what a query of one table cannot say, composed from the modules that know).
 */
export class User_Module extends Module {

  static initialize(base: CooperBase, deps: User_Deps, options: User_Options): User_Module {
    const module = new User_Module(base, deps, options)
    registerUserRoutes(base, module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: User_Deps, private readonly options: User_Options) {
    super('user', base.invocations, deps)
  }

  /** Every account, the newest first, each saying whether it is staff; with a text, those whose email or name it is. */
  @UseCase()
  async list(input: UserSearchDTO, page: PageRequest): Promise<Page<UserSummaryDTO>> {
    const { text } = UserSearchSchema.parse(input)
    const filter: UserFilterDTO | undefined = text
      ? { or: [{ field: 'email', op: 'ieq', value: text }, { field: 'name', op: 'ieq', value: text }] }
      : undefined
    const users = await this.deps.auth.user.list(filter, page)
    // One question to auth per account of the page: a page is short, and auth says it fresh.
    const items = await Promise.all(users.items.map(async user => ({ ...user, staff: await this.deps.staff.isStaff(user.id) })))
    return { ...users, items }
  }

  @UseCase()
  async get(userId: string): Promise<UserDetailDTO> {
    const user = await this.deps.auth.user.get(userId)
    const [staff, workspaces] = await Promise.all([
      this.deps.staff.isStaff(userId),
      this.deps.auth.access.listForUser(userId, { size: 1 }, this.options.workspacesProduct),
    ])
    return { ...user, staff, workspaces: workspaces.total }
  }

  /** The workspaces someone belongs to, the ones they joined last first, with their role in each. */
  @UseCase()
  async workspaces(userId: string, page: PageRequest): Promise<Page<UserWorkspaceDTO>> {
    await this.deps.auth.user.get(userId)
    const accesses = await this.deps.auth.access.listForUser(userId, page, this.options.workspacesProduct)
    const tenants = new Map((await this.deps.auth.tenant.getMany(accesses.items.flatMap(access => access.tenantId ?? []))).map(tenant => [tenant.id, tenant]))
    // A workspace deleted a moment ago, whose accesses are not taken away yet, is left out.
    return mapPage(accesses, access => {
      const tenant = tenants.get(access.tenantId ?? '')
      return tenant && { id: access.id, workspaceId: tenant.id, name: tenant.name, role: access.role, since: access.createdAt }
    })
  }
}
```

- **`list`** turns the text into auth's `UserFilter` ([chapter
  18](./18-tenants-and-access)): the email or the name, whole, whatever its case
  (`ieq`). The filter is auth's, so auth decides what may be filtered by; the backoffice
  only builds one. Then it asks whether each account is staff. That is one question
  per account of the page, side by side: a page is short, and the answer is auth's,
  fresh.
- **`get`** asks two things at once: whether they are staff, and their workspaces with
  a page of one. Only the page's `total` is used. No list is returned whole, not even
  to another context, so counting is a page of one.
- **`workspaces`** pages someone's accesses to the product `cooper`, then asks for the
  tenants of the whole page at once (`tenant.getMany`). `getMany` leaves deleted
  tenants out, so a workspace deleted a moment ago, whose accesses are not taken away
  yet, maps to nothing and is dropped. It first calls `user.get`: an account that does
  not exist is auth's `UserNotFound`, a 404, not an empty list.

## Workspaces

A workspace's page shows its name, its admin, how many members and boards it has, and
how many cards. That is auth's tenants, accesses and accounts, and boards' boards and
cards. The backoffice's `workspace` module owns none of it. Its deps list the modules
that do:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.deps.ts
import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module } from '../../../auth/modules/user/user.module'
import type { Board_Module } from '../../../boards/modules/board/board.module'
import type { Card_Module } from '../../../boards/modules/card/card.module'
import type { Staff_Module } from '../staff/staff.module'

/**
 * What a workspace's page is made of, each part asked to the module that keeps it:
 * auth's tenants, accesses and accounts, and boards' boards and cards. Only their use
 * cases, never their repositories.
 */
export interface Workspace_Deps {
  /** That who asks is of the staff, before any route answers. */
  staff: Staff_Module
  auth: {
    tenant: Tenant_Module
    access: Access_Module
    user: User_Module
  }
  boards: {
    board: Board_Module
    /** How many cards each workspace and board has: Kysely's counts, in boards. */
    card: Card_Module
  }
}
```

The shapes it answers with, each taking its fields' types from the context that keeps
them:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.schema.ts
import { z } from 'zod'
import type { AccessRole } from '../../../auth/modules/access/access.schema'
import type { TenantDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { BoardDTO } from '../../../boards/modules/board/board.schema'
import type { PersonDTO } from '../user/user.schema'

/** How the staff look workspaces up: by their name, whole, whatever its case. */
export const WorkspaceSearchSchema = z.object({
  name: z.string().trim().max(60).optional(),
})

/** A workspace in the staff's list: who its admin is, and how many cards it holds. */
export type WorkspaceSummaryDTO = Pick<TenantDTO, 'id' | 'name' | 'createdAt'> & {
  /** Null only for an account gone since. */
  admin: PersonDTO | null
  cards: number
}

/** A workspace on its own page: its summary, and how many members and boards it has. */
export type WorkspaceDetailDTO = WorkspaceSummaryDTO & {
  members: number
  boards: number
}

/** Someone of a workspace: its `id` is their access's, by which the list goes page after page. */
export type WorkspaceMemberDTO = PersonDTO & {
  id: string
  userId: string
  role: AccessRole
  since: string
}

/** A board of a workspace, with how many cards it has. */
export type WorkspaceBoardDTO = Pick<BoardDTO, 'id' | 'name' | 'description' | 'createdAt'> & {
  cards: number
}

/** A board just created, in whatever workspace, with its workspace's name. */
export type RecentBoardDTO = Pick<BoardDTO, 'id' | 'name' | 'workspaceId' | 'createdAt'> & {
  /** Null only for a workspace deleted since. */
  workspaceName: string | null
}

export type WorkspaceSearchDTO = z.input<typeof WorkspaceSearchSchema>
```

The routes:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

export function registerWorkspaceRoutes(base: CooperBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `?name=acme`: a workspace's name, whole.
  routes.get('/workspaces', async request => {
    const name = new URL(request.url).searchParams.get('name') || undefined
    return Response.json(await workspaces.list({ name }, pageRequestFrom(request)))
  })

  // The latest boards of every workspace: a path of its own, before any workspace's id.
  routes.get('/workspaces/recent-boards', async () => Response.json(await workspaces.recentBoards()))

  routes.get('/workspaces/:workspaceId', async request => Response.json(await workspaces.get(request.params.workspaceId)))

  routes.get('/workspaces/:workspaceId/members', async request =>
    Response.json(await workspaces.members(request.params.workspaceId, pageRequestFrom(request))))

  routes.get('/workspaces/:workspaceId/boards', async request =>
    Response.json(await workspaces.boards(request.params.workspaceId, pageRequestFrom(request))))
}
```

`/workspaces/recent-boards` is registered before `/workspaces/:workspaceId`, and says
so: it is a path of its own, not the workspace whose id is `recent-boards`.

And the module:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.module.ts
import { mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { TenantDTO, TenantFilterDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { PersonDTO } from '../user/user.schema'
import type { Workspace_Deps } from './workspace.deps'
import { registerWorkspaceRoutes } from './workspace.routes'
import {
  WorkspaceSearchSchema,
  type RecentBoardDTO,
  type WorkspaceBoardDTO,
  type WorkspaceDetailDTO,
  type WorkspaceMemberDTO,
  type WorkspaceSearchDTO,
  type WorkspaceSummaryDTO,
} from './workspace.schema'

/** How many boards the overview shows as the latest. */
const RECENT_BOARDS = 8

/**
 * cooper's workspaces, as the staff look at them: auth keeps who they are and who
 * belongs to each, boards what is in them. This module keeps nothing: each screen is
 * put together from the use cases of the modules that know, a handful of
 * calls per page, never one per row.
 */
export class Workspace_Module extends Module {

  static initialize(base: CooperBase, deps: Workspace_Deps): Workspace_Module {
    const module = new Workspace_Module(base, deps)
    registerWorkspaceRoutes(base, module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: Workspace_Deps) {
    super('workspace', base.invocations, deps)
  }

  /** Every workspace, the newest first; with a name, those with it. With its admin and its cards. */
  @UseCase()
  async list(input: WorkspaceSearchDTO, page: PageRequest): Promise<Page<WorkspaceSummaryDTO>> {
    const { name } = WorkspaceSearchSchema.parse(input)
    const filter: TenantFilterDTO | undefined = name ? { field: 'name', op: 'ieq', value: name } : undefined
    const found = await this.deps.auth.tenant.list(filter, page)
    return { ...found, items: await this.summaries(found.items) }
  }

  @UseCase()
  async get(workspaceId: string): Promise<WorkspaceDetailDTO> {
    const tenant = await this.deps.auth.tenant.get(workspaceId)
    const [[summary], members, boards] = await Promise.all([
      this.summaries([tenant]),
      this.deps.auth.access.listForTenant(workspaceId, { size: 1 }),
      this.deps.boards.board.listOf(workspaceId, { size: 1 }),
    ])
    return { ...summary!, members: members.total, boards: boards.total }
  }

  /** Its members, the oldest first: its admin leads. */
  @UseCase()
  async members(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceMemberDTO>> {
    await this.deps.auth.tenant.get(workspaceId)
    const accesses = await this.deps.auth.access.listForTenant(workspaceId, page)
    const people = await this.people(accesses.items.map(access => access.userId))
    return mapPage(accesses, access => {
      const person = people.get(access.userId)
      return person && { ...person, id: access.id, userId: person.id, role: access.role, since: access.createdAt }
    })
  }

  /** Its boards, the newest first, each with how many cards it has. */
  @UseCase()
  async boards(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceBoardDTO>> {
    await this.deps.auth.tenant.get(workspaceId)
    const [boards, counts] = await Promise.all([
      this.deps.boards.board.listOf(workspaceId, page),
      this.deps.boards.card.countByBoard(workspaceId),
    ])
    const cards = new Map(counts.map(count => [count.boardId, count.cards]))
    return mapPage(boards, board => ({ id: board.id, name: board.name, description: board.description, createdAt: board.createdAt, cards: cards.get(board.id) ?? 0 }))
  }

  /** The boards created last across every workspace, each with its workspace's name: two calls. */
  @UseCase()
  async recentBoards(): Promise<RecentBoardDTO[]> {
    const boards = await this.deps.boards.board.recentInEveryWorkspace(RECENT_BOARDS)
    const tenants = new Map((await this.deps.auth.tenant.getMany([...new Set(boards.map(board => board.workspaceId))])).map(tenant => [tenant.id, tenant.name]))
    return boards.map(board => ({ id: board.id, name: board.name, workspaceId: board.workspaceId, createdAt: board.createdAt, workspaceName: tenants.get(board.workspaceId) ?? null }))
  }

  /** Workspaces as the list shows them: two calls for the whole page, its admins and its cards. */
  private async summaries(tenants: TenantDTO[]): Promise<WorkspaceSummaryDTO[]> {
    const [admins, counts] = await Promise.all([
      this.people(tenants.map(tenant => tenant.createdBy)),
      this.deps.boards.card.countByWorkspace(tenants.map(tenant => tenant.id)),
    ])
    const cards = new Map(counts.map(count => [count.workspaceId, count.cards]))
    return tenants.map(tenant => ({
      id: tenant.id,
      name: tenant.name,
      createdAt: tenant.createdAt,
      admin: admins.get(tenant.createdBy) ?? null,
      cards: cards.get(tenant.id) ?? 0,
    }))
  }

  private async people(userIds: string[]): Promise<Map<string, PersonDTO>> {
    const users = await this.deps.auth.user.getMany(userIds)
    return new Map(users.map(user => [user.id, { id: user.id, name: user.name, email: user.email }]))
  }
}
```

Every use case is a few calls to the modules that know, run side by side where they do
not depend on each other:

- **`get`** asks `tenant.get` first and alone. A workspace that does not exist throws
  auth's `TenantNotFound`, a 404, before anything else runs. Then three calls at once:
  its summary, and a page of one of its members and of its boards, for their totals.
  `members` and `boards` start with `tenant.get` for the same reason.
- **`summaries`** puts a page of workspaces together in two calls, whatever its size:
  the admins of the whole page (`user.getMany`), and the cards of every workspace on
  it (`card.countByWorkspace`). Asking per workspace would be one call per row. This is
  why auth offers `user.getMany` and boards offers `card.countByWorkspace` with a list
  of ids: a context that others read from offers its reads in batches.
- **`boards`** pages the workspace's boards (`board.listOf`) and counts every board's
  cards in one query (`card.countByBoard`), both from boards. [Chapter
  15](./15-kysely) wrote those counts with Kysely, for this module.
- **`recentBoards`** reads across every workspace on purpose:
  `board.recentInEveryWorkspace` ([chapter 4](./04-who-and-where)) says so in its
  name. Then one call for the names of their workspaces.

A deleted workspace or an account gone since does not break a page: it maps to `null`
(`admin`, `workspaceName`) or is left out, and the types say so.

## The modules, wired

`initialize-modules.ts` says what the backoffice is given and hands each module its
part:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
import type { CooperBase } from '../../shared/cooper-base'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { PRODUCTS, WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
import type { Boards_Modules } from '../boards/initialize-modules'
import type { Backoffice_Config } from './backoffice-config'
import { Staff_Module } from './modules/staff/staff.module'
import { User_Module } from './modules/user/user.module'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * What `backoffice`'s modules are given besides its base: the use cases of the
 * contexts it reads, those it needs and nothing else. Never a context's base nor its
 * store: another context is reached through its use cases and its events.
 */
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token'>
  boards: Pick<Boards_Modules, 'board' | 'card'>
}

/**
 * Every module of `backoffice`, each one after the modules it uses. They read auth and
 * boards through their modules' use cases, and keep only their sessions, in the
 * context's own database.
 */
export function initializeModules(base: CooperBase, config: Backoffice_Config, deps: Backoffice_ModuleDeps) {
  const { auth, boards } = deps

  const staff = Staff_Module.initialize(base, { auth: { user: auth.user, access: auth.access } }, { productId: PRODUCTS.backoffice })
  const session = WebSession_Module.initialize(base, {
    context: 'backoffice',
    clientId: PRODUCTS.backoffice,
    clientSecret: config.clientSecret,
    publicUrl: config.publicUrl,
    authUrl: config.authPublicUrl,
    days: config.sessionDays,
    identify: accessToken => auth.token.verify(accessToken),
    // `{ user }`, as every web app reads its session; only for the staff: anyone else,
    // an access taken away since signing in, gets a 403.
    profile: async () => ({ user: await staff.me() }),
  })
  const user = User_Module.initialize(base, { staff, auth: { user: auth.user, access: auth.access, tenant: auth.tenant } }, { workspacesProduct: WORKSPACES_PRODUCT })
  const workspace = Workspace_Module.initialize(base, { staff, auth: { tenant: auth.tenant, access: auth.access, user: auth.user }, boards: { board: boards.board, card: boards.card } })
  return { session, staff, user, workspace }
}

export type Backoffice_Modules = ReturnType<typeof initializeModules>
```

### `Backoffice_ModuleDeps`: a `Pick` of each context

The backoffice is given auth's and boards' **modules**, not the contexts. A context
has a base, and a base has a store. What the backoffice may touch is written in its
deps type, as a `Pick` of each context's modules. `openContexts` (below) passes
`auth.modules` whole, and TypeScript accepts it where a `Pick` is asked for; but
inside the backoffice only the named modules exist. There is no `deps.auth.base.store`
to reach for, and a reviewer sees at a glance which of auth's modules the backoffice
depends on. Adding one is a change to this type, in plain sight.

Each module is then handed only the ones it uses, under the name of their context:
`{ staff, auth: { user, access, tenant } }` for `user`, and `boards: { board, card }`
besides for `workspace`. The modules pass them to `super`, so the backoffice's
dependencies on auth and boards are as visible as boards' on auth.

### Signing the staff in

The staff sign in with auth, as everyone does: the backoffice is an OAuth client of
auth's, like boards. `WebSession_Module`, from [chapter 22](./22-web-session), does
all of it; the backoffice only fills in its options:

- **`context: 'backoffice'`** names its cookies: `cooper_backoffice_session`, not
  boards'. Each context has its own port and, in production, its own domain, so its
  sessions are its own.
- **`clientId: PRODUCTS.backoffice`** is the client auth declared for the product
  `backoffice`, whose redirect URI is the backoffice's public URL and the web
  session's callback. `clientSecret` is its secret, from `config.ts`.
- **`identify`** is auth's `token.verify`, as in boards.
- **`profile`** is what `GET /api/session` answers, `{ user }` as every web app reads
  it. Here it is `staff.me()`, which checks first: someone whose access was taken away
  since they signed in gets a 403 from `/api/session` too.

Who may sign in at all is decided earlier, by auth. The product `backoffice` gives
access only to whom it was told (`access: 'granted'`, [chapter
21](./21-oauth-server)), so auth does not let anyone else say yes to the backoffice:
approving answers `oauthGrant.no_access`, a 403. They can only go back. The web
session's routes are registered on `base.http`, outside `staffRoutes`: signing in
must work before anyone is known to be staff.

So there are two checks, at two moments. auth refuses at signing in whoever is not
staff. `staff.enter` refuses, on every request, whoever stopped being staff since.

## The context

The context opens its store with its migrations, and initializes its modules with
what it is given:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
import { CooperBase } from '../../shared/cooper-base'
import { ServedContext } from '../../shared/served-context'
import type { Backoffice_Config } from './backoffice-config'
import { initializeModules, type Backoffice_ModuleDeps, type Backoffice_Modules } from './initialize-modules'

/**
 * The staff's console: it reads `auth` and `boards`, and changes them only through
 * their use cases. Only the staff (access to the `backoffice` app in `auth`) enter it.
 * Its own database keeps its web sessions.
 */
export class Backoffice_Context extends ServedContext {

  private constructor(base: CooperBase, readonly modules: Backoffice_Modules, readonly config: Backoffice_Config) {
    super('backoffice', base, config)
  }

  /** Opened after `auth` and `boards`, which it uses; on the real time, unless a test gives it a `clock`. */
  static async open(config: Backoffice_Config, deps: Backoffice_ModuleDeps, clock?: Clock): Promise<Backoffice_Context> {
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new CooperBase({ name: 'backoffice', store, clock })
    return new Backoffice_Context(base, initializeModules(base, config, deps), config)
  }
}
```

It is a `ServedContext` ([chapter 21](./21-oauth-server)): its own server, its API
under `/api`, `/api/health`, and its built frontend for any other address, once there
is one. It overrides no `routes()`: it has nothing outside `/api`.

## Opening three contexts

`openContexts` opens the backoffice last, after the two it reads. In
`open-contexts.ts`, import it:

```ts
// cooper/backend/open-contexts.ts
import { Auth_Context } from './contexts/auth/auth.context'
import { Backoffice_Context } from './contexts/backoffice/backoffice.context'
import { Boards_Context } from './contexts/boards/boards.context'
```

say so in the function's comment, and open it:

```ts
// cooper/backend/open-contexts.ts
// …
/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`, then `backoffice`, which reads both. The
 * server opens them, and so does any script that works with their modules (the seed).
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  const { clock } = options
  const auth = await Auth_Context.open(config.auth, { mailer }, clock)
  // For now each card's move is a line on the console (chapter 28 writes it only while tracing).
  const boards = await Boards_Context.open(config.boards, { auth: auth.modules, mailer, search: new MemoryCardSearch(), log: line => console.log(line) }, clock)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, clock)
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}
// …
```

`all` is in the order they open. `stopContexts` stops them in reverse, so the
backoffice stops before the contexts it uses. `index.ts` serves every context in
`all`, so the backoffice gets its server, on port 3003, without a line there.

Nothing stands between the backoffice and the contexts it reads: no adapter, no port.
It takes their modules as they are, as boards takes auth's since
[chapter 20](./20-wiring-contexts). The backoffice has no rules of its own about
workspaces or accounts; it shows auth's and boards'.

## The lint: backoffice uses auth and boards

The backoffice's files import auth's and boards' (their module classes, their schemas,
`PRODUCTS`). Say so in `eslint.config.js`:

```js
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
```

`uses` is still a tree: nothing uses the backoffice, so auth and boards can never
import it. Without the change, `newt/context-boundaries` refuses every import of
auth or boards from the backoffice's folder, as it refused boards' in [chapter
20](./20-wiring-contexts).

Tell the coding agents too: in `cooper/AGENTS.md`, add the backoffice to `## Contexts`,
after auth:

```md
- backoffice: what the staff see and do across the others. Uses auth and boards.
```

## Tests

### The backoffice for a test

The backoffice is only interesting with real data in auth and boards. Its tests open
all three contexts as the server does, every database in memory, and make the data
through auth's and boards' own use cases, as anyone would. Create
`testing/open-test-backoffice.ts`:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
import { runAsActor } from 'newt/core'
import { config, type Config } from '../../../config'
import { openContexts, stopContexts, type OpenContextsOptions } from '../../../open-contexts'
import { PRODUCTS } from '../../auth/modules/product/product.schema'
import type { UserDTO } from '../../auth/modules/user/user.schema'
import { runInWorkspace } from '../../boards/workspace-scope'

/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: 0 },
    boards: { ...config.boards, database: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, database: ':memory:', port: 0 },
  }
}

/**
 * The backoffice for a test, with the real auth and boards it reads, as the server
 * opens them: every database in memory, the emails in a list. The data is made
 * through auth's and boards' own use cases, as anyone would. A test that moves the
 * time gives every context its `clock`.
 */
export async function openTestBackoffice(options: Pick<OpenContextsOptions, 'clock'> = {}) {
  const contexts = await openContexts(testConfig(), { mailer: { send: async () => {} }, ...options })
  const { auth, boards, backoffice } = contexts

  /** An account, as someone signs up in auth. */
  const signUp = (name: string): Promise<UserDTO> =>
    auth.modules.user.signUp({ email: `${name.toLowerCase()}@cooper.test`, name, password: 'a long password' })

  return {
    auth,
    boards,
    backoffice,
    modules: backoffice.modules,
    signUp,
    /** Someone of the staff, as the seed makes the first one. */
    async staffMember(name: string): Promise<UserDTO> {
      const user = await signUp(name)
      await auth.modules.access.admit({ userId: user.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
      return user
    },
    as<T>(user: UserDTO, fn: () => Promise<T>): Promise<T> {
      return runAsActor({ userId: user.id, via: 'web' }, fn)
    },
    /** A board with a column, made in a workspace by someone of it, with cards titled as given. */
    async board(user: UserDTO, workspaceId: string, name: string, cards: string[]) {
      return runAsActor({ userId: user.id, via: 'web' }, () => runInWorkspace(workspaceId, async () => {
        const board = await boards.modules.board.create({ name })
        const column = await boards.modules.column.add(board.id, { name: 'To do' })
        for (const title of cards) await boards.modules.card.create(board.id, { columnId: column.id, title })
        return board
      }))
    },
    /**
     * Until the background work is done, in the order it flows: auth's events (heard
     * by boards), then boards'.
     */
    async settled(): Promise<void> {
      for (let round = 0; round < 2; round++) {
        for (const context of contexts.all) await context.base.jobs.idle()
      }
    },
    close: () => stopContexts(contexts),
  }
}

export type TestBackoffice = Awaited<ReturnType<typeof openTestBackoffice>>
```

- **`staffMember`** signs someone up and admits them to the backoffice with
  `access.admit`, which checks no actor: the same way the seed makes the first staff
  member (next chapter). Granting needs staff, and there is none yet.
- **`as`** runs a call as someone, as a request would.
- **`board`** makes a board with a column and cards, in a workspace, as one of its
  members.
- **`settled`** waits for the background work in the order it flows. auth's jobs run
  first (boards hears auth's events: a new workspace's welcome board), then boards'.
  Two rounds, because boards' reactions to auth's events tell events of their own.

### The modules

The staff: who gets in, granting, revoking, and auth checking again:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('staff', () => {
  let t: TestBackoffice

  beforeEach(async () => {
    t = await openTestBackoffice()
  })

  afterEach(() => t.close())

  test('lets the staff in, and refuses anyone else', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')

    expect(await t.as(sam, () => t.modules.staff.me())).toMatchObject({ id: sam.id, email: 'sam@cooper.test' })
    await expect(t.as(ana, () => t.modules.staff.enter())).rejects.toMatchObject({ code: 'staff.not_staff' })
    await expect(t.as(ana, () => t.modules.staff.me())).rejects.toMatchObject({ code: 'staff.not_staff' })
  })

  test('grants by email, lists the staff, and revokes, which counts at once', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')

    const granted = await t.as(sam, () => t.modules.staff.grant({ email: ' ANA@cooper.test ' }))
    expect(granted).toMatchObject({ userId: ana.id, name: 'Ana', email: 'ana@cooper.test' })
    // Given twice, it is given once.
    expect(await t.as(sam, () => t.modules.staff.grant({ email: 'ana@cooper.test' }))).toEqual(granted)
    expect((await t.as(sam, () => t.modules.staff.list({ size: 10 }))).items.map(member => member.name)).toEqual(['Sam', 'Ana'])
    await t.as(ana, () => t.modules.staff.enter())

    await t.as(sam, () => t.modules.staff.revoke(ana.id))
    await expect(t.as(ana, () => t.modules.staff.enter())).rejects.toMatchObject({ code: 'staff.not_staff' })
    expect((await t.as(sam, () => t.modules.staff.list({ size: 10 }))).total).toBe(1)
  })

  test('never grants to an email without an account, nor lets anyone take their own access away', async () => {
    const sam = await t.staffMember('Sam')

    await expect(t.as(sam, () => t.modules.staff.grant({ email: 'nobody@cooper.test' }))).rejects.toMatchObject({ code: 'staff.account_not_found' })
    await expect(t.as(sam, () => t.modules.staff.grant({ email: 'not an email' }))).rejects.toThrow('Write a valid email')
    await expect(t.as(sam, () => t.modules.staff.revoke(sam.id))).rejects.toMatchObject({ code: 'staff.own_access_not_revocable' })
    await t.as(sam, () => t.modules.staff.enter())
  })

  test('only the staff grant: auth checks it again', async () => {
    const ana = await t.signUp('Ana')
    await t.signUp('Bob')

    await expect(t.as(ana, () => t.modules.staff.grant({ email: 'bob@cooper.test' }))).rejects.toMatchObject({ status: 403 })
  })
})
```

The last test is the one that matters for the rule above. Ana is not staff, and the
backoffice does not stop her from calling `staff.grant`. auth does.

The accounts:

```ts
// cooper/backend/contexts/backoffice/modules/user/user.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('user', () => {
  let t: TestBackoffice

  beforeEach(async () => {
    t = await openTestBackoffice()
  })

  afterEach(() => t.close())

  test('lists the accounts, the newest first, marking the staff; by email or name too', async () => {
    const sam = await t.staffMember('Sam')
    await t.signUp('Ana')
    await t.signUp('Bob')

    const all = await t.as(sam, () => t.modules.user.list({}, { size: 10 }))
    expect(all.items.map(user => user.name)).toEqual(['Bob', 'Ana', 'Sam'])
    expect(all.items.map(user => user.staff)).toEqual([false, false, true])
    expect((await t.as(sam, () => t.modules.user.list({ text: 'ANA@cooper.test' }, { size: 10 }))).items.map(user => user.name)).toEqual(['Ana'])
    expect((await t.as(sam, () => t.modules.user.list({ text: 'bob' }, { size: 10 }))).items.map(user => user.name)).toEqual(['Bob'])
  })

  test('shows an account with the workspaces it belongs to, and whether it is of the staff', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')
    const acme = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    const globex = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Globex' }))
    await t.settled()

    expect(await t.as(sam, () => t.modules.user.get(ana.id))).toMatchObject({ id: ana.id, name: 'Ana', staff: false, workspaces: 2 })
    expect(await t.as(sam, () => t.modules.user.get(sam.id))).toMatchObject({ staff: true, workspaces: 0 })

    const workspaces = await t.as(sam, () => t.modules.user.workspaces(ana.id, { size: 10 }))
    expect(workspaces.items.map(each => [each.workspaceId, each.name, each.role])).toEqual([[globex.id, 'Globex', 'admin'], [acme.id, 'Acme', 'admin']])
  })
})
```

The workspaces. A new workspace has a welcome board with cards (`workspace.prepare`,
[chapter 14](./14-sagas)), so the counts are compared with boards' own, or checked to
be at least what the test made:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import { runInWorkspace } from '../../../boards/workspace-scope'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('workspace', () => {
  let t: TestBackoffice
  let sam: UserDTO
  let ana: UserDTO
  let bob: UserDTO

  beforeEach(async () => {
    t = await openTestBackoffice()
    sam = await t.staffMember('Sam')
    ana = await t.signUp('Ana')
    bob = await t.signUp('Bob')
  })

  afterEach(() => t.close())

  /** Ana's workspace, with Bob in it. */
  async function acme() {
    const tenant = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    await t.auth.modules.access.admit({ userId: bob.id, productId: 'cooper', tenantId: tenant.id, role: 'member' })
    await t.settled()
    return tenant
  }

  test('lists the workspaces, the newest first, with their admin and their cards; by name too', async () => {
    const first = await acme()
    const second = await t.as(bob, () => t.auth.modules.tenant.create({ name: 'Globex' }))
    await t.board(ana, first.id, 'Roadmap', ['One', 'Two'])
    await t.settled()
    const cards = await t.boards.modules.card.countByWorkspace([first.id, second.id])

    const all = await t.as(sam, () => t.modules.workspace.list({}, { size: 10 }))
    expect(all.items.map(each => [each.name, each.admin?.name, each.cards])).toEqual([
      ['Globex', 'Bob', cards[1]!.cards],
      ['Acme', 'Ana', cards[0]!.cards],
    ])
    expect(cards[0]!.cards).toBeGreaterThanOrEqual(2)

    const found = await t.as(sam, () => t.modules.workspace.list({ name: ' ACME ' }, { size: 10 }))
    expect(found.items.map(each => each.id)).toEqual([first.id])
  })

  test('puts a workspace\'s page together: its admin, members and boards with their cards', async () => {
    const tenant = await acme()
    const roadmap = await t.board(ana, tenant.id, 'Roadmap', ['One', 'Two', 'Three'])
    const empty = await t.board(ana, tenant.id, 'Empty', [])

    const detail = await t.as(sam, () => t.modules.workspace.get(tenant.id))
    expect(detail).toMatchObject({ id: tenant.id, name: 'Acme', admin: { id: ana.id, name: 'Ana' }, members: 2 })
    expect(detail.boards).toBeGreaterThanOrEqual(2)

    const members = await t.as(sam, () => t.modules.workspace.members(tenant.id, { size: 10 }))
    expect(members.items.map(member => [member.name, member.role])).toEqual([['Ana', 'admin'], ['Bob', 'member']])

    const boards = await t.as(sam, () => t.modules.workspace.boards(tenant.id, { size: 10 }))
    expect(boards.items).toContainEqual(expect.objectContaining({ id: roadmap.id, name: 'Roadmap', cards: 3 }))
    expect(boards.items).toContainEqual(expect.objectContaining({ id: empty.id, cards: 0 }))
  })

  test('shows the boards created last across every workspace, archived ones out', async () => {
    const acmeTenant = await acme()
    const globex = await t.as(bob, () => t.auth.modules.tenant.create({ name: 'Globex' }))
    await t.settled()
    const roadmap = await t.board(ana, acmeTenant.id, 'Roadmap', [])
    const old = await t.board(bob, globex.id, 'Old', [])
    await t.as(bob, () => runInWorkspace(globex.id, () => t.boards.modules.board.archive(old.id)))

    const recent = await t.as(sam, () => t.modules.workspace.recentBoards())
    expect(recent[0]).toMatchObject({ id: roadmap.id, name: 'Roadmap', workspaceName: 'Acme' })
    expect(recent.map(board => [board.name, board.workspaceName])).toContainEqual(['Welcome', 'Globex'])
    expect(recent.map(board => [board.name, board.workspaceName])).toContainEqual(['Welcome', 'Acme'])
    expect(recent.some(board => board.id === old.id)).toBe(false)
  })

  test('a workspace that is not there is not found', async () => {
    await expect(t.as(sam, () => t.modules.workspace.get('0190a0a0-0000-7000-8000-000000000000'))).rejects.toMatchObject({ status: 404 })
    await expect(t.as(sam, () => t.modules.workspace.boards('0190a0a0-0000-7000-8000-000000000000', { size: 10 }))).rejects.toMatchObject({ status: 404 })
  })
})
```

### The API

The API test replaces the session's authenticator with an `x-user` header, as boards'
tests did before the web session, and asks every route as nobody, as staff, and as
someone just revoked:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
import { openTestBackoffice, type TestBackoffice } from './testing/open-test-backoffice'

describe('the backoffice API', () => {
  let t: TestBackoffice
  let server: Server<undefined>

  beforeEach(async () => {
    t = await openTestBackoffice()
    // Who asks, by a header: the real authenticator reads the web session's cookie (shared/web-session tests it).
    t.backoffice.base.http.authenticateWith(async request => {
      const userId = request.headers.get('x-user')
      return userId ? { userId, via: 'web' as const } : null
    })
    server = serve(t.backoffice.serving())
  })

  afterEach(async () => {
    await server.stop()
    await t.close()
  })

  const get = (path: string, userId?: string) => fetch(new URL(path, server.url), { headers: userId ? { 'x-user': userId } : {} })

  test('answers only the staff: 401 without a session, 403 to anyone else, at once after a revoke', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.staffMember('Ana')

    for (const path of ['/api/session', '/api/workspaces', '/api/users', '/api/staff']) {
      expect((await get(path)).status).toBe(401)
      expect((await get(path, ana.id)).status).toBe(200)
    }
    expect(await (await get('/api/session', ana.id)).json()).toMatchObject({ user: { id: ana.id, name: 'Ana', email: 'ana@cooper.test' } })

    await t.as(sam, () => t.modules.staff.revoke(ana.id))
    for (const path of ['/api/session', '/api/workspaces', '/api/users/' + sam.id, '/api/staff']) {
      const response = await get(path, ana.id)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'staff.not_staff' })
    }
  })

  test('says what is not there with a 404, to the staff', async () => {
    const sam = await t.staffMember('Sam')
    expect((await get('/api/workspaces/0190a0a0-0000-7000-8000-000000000000', sam.id)).status).toBe(404)
    expect((await get('/api/users/0190a0a0-0000-7000-8000-000000000000', sam.id)).status).toBe(404)
  })
})
```

The second loop is the point of `staffRoutes`: Ana signed in while she was staff, and
her session is still good, but every route refuses her from the next request on.

### Signing in

The other half: signing in through auth, end to end, over HTTP. auth and the
backoffice are served on free ports, and newt's `browser()` from `newt/testing`
follows redirects and keeps cookies per origin, as a browser does ([chapter
22](./22-web-session)):

```ts
// cooper/backend/contexts/backoffice/backoffice-sign-in.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
import { browser, freePort, type Browser } from 'newt/testing'
import { config, type Config } from '../../config'
import { openContexts, stopContexts } from '../../open-contexts'
import { PRODUCTS } from '../auth/modules/product/product.schema'

describe('signing in to the backoffice', () => {
  let contexts: Awaited<ReturnType<typeof openContexts>>
  let servers: Server<undefined>[]
  let authUrl: string
  let backofficeUrl: string

  beforeEach(async () => {
    const [authPort, backofficePort] = [freePort(), freePort()]
    authUrl = `http://localhost:${authPort}`
    backofficeUrl = `http://localhost:${backofficePort}`
    const testConfig: Config = {
      ...config,
      auth: { ...config.auth, database: ':memory:', port: authPort, publicUrl: authUrl, backofficePublicUrl: backofficeUrl },
      boards: { ...config.boards, database: ':memory:', port: 0 },
      backoffice: { ...config.backoffice, database: ':memory:', port: backofficePort, publicUrl: backofficeUrl, authPublicUrl: authUrl },
    }
    contexts = await openContexts(testConfig, { mailer: { send: async () => {} } })
    servers = [serve(contexts.auth.serving()), serve(contexts.backoffice.serving())]
  })

  afterEach(async () => {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
  })

  /** Someone with an account signs in at auth, on their way to the backoffice, and says yes to it. */
  async function signIn(email: string) {
    const as = browser()
    const started = await as(`${backofficeUrl}/api/session/sign-in?returnTo=/staff`)
    const authorize = await as(started.headers.get('location')!)
    const id = authorize.headers.get('location')!.split('/authorize/')[1]!
    await as(`${authUrl}/api/session/sign-in`, { method: 'POST', json: { email, password: 'a long password' } })
    return { as, id, approved: await as(`${authUrl}/api/authorizations/${id}/approve`, { method: 'POST' }) }
  }

  /** Where auth sends the browser back to the backoffice. */
  const back = async (as: Browser, answer: Response) => as(((await answer.json()) as { redirectTo: string }).redirectTo)

  test('lets the staff in, and refuses at auth whoever is not', async () => {
    const { user, access } = contexts.auth.modules
    const sam = await user.signUp({ email: 'sam@cooper.test', name: 'Sam', password: 'a long password' })
    await access.admit({ userId: sam.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
    await user.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })

    const staff = await signIn('sam@cooper.test')
    expect((await back(staff.as, staff.approved)).headers.get('location')).toBe('/staff')
    expect(await (await staff.as(`${backofficeUrl}/api/session`)).json()).toMatchObject({ user: { id: sam.id, email: 'sam@cooper.test' } })
    expect((await staff.as(`${backofficeUrl}/api/staff`)).status).toBe(200)

    // auth does not let her say yes: the backoffice lets in only whom it was told. She can only go back.
    const other = await signIn('ana@cooper.test')
    expect(other.approved.status).toBe(403)
    expect(await other.approved.json()).toMatchObject({ code: 'oauthGrant.no_access' })
    const denied = await other.as(`${authUrl}/api/authorizations/${other.id}/deny`, { method: 'POST' })
    expect((await back(other.as, denied)).headers.get('location')).toBe('/?signInError=session.sign_in_denied')
    expect((await other.as(`${backofficeUrl}/api/session`)).status).toBe(401)
  })
})
```

Sam, of the staff, signs in and lands on `/staff`. Ana has an account but no access:
auth answers her approval with `oauthGrant.no_access`, she can only deny, and she
comes back to the backoffice with `signInError` and no session.

### Three contexts everywhere

Two tests open every context, and now there are three. In `open-contexts.test.ts`, the
backoffice gets a database in memory and any port:

```ts
// cooper/backend/open-contexts.test.ts
// …
    boards: { ...config.boards, database: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, database: ':memory:', port: 0 },
  }
}
// …
```

and the test expects three of everything:

```ts
// cooper/backend/open-contexts.test.ts
// …
test('opens the three contexts, serves each on its own port, and stops them', async () => {
  const mailer = new RecordingMailer()
  const mails = mailer.mails
  const contexts = await openContexts(testConfig(), { mailer })
  expect(contexts.all.map(context => context.name)).toEqual(['auth', 'boards', 'backoffice'])

  const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })), { signals: false })
  try {
    const servers = Object.values(app.servers)
    expect(Object.keys(app.servers)).toEqual(['auth', 'boards', 'backoffice'])
    expect(new Set(servers.map(server => server.port)).size).toBe(3)
// …
```

In `cooper.test.ts`, its comment names the three:

```ts
// cooper/backend/cooper.test.ts
// …
/**
 * cooper end to end: auth, boards and backoffice open as the server opens them, on
 * SQLite in memory, and boards used as its UI and an MCP client use it, over HTTP.
 */
// …
```

and its `testConfig` gives the backoffice a database in memory, any port, and the
test's auth:

```ts
// cooper/backend/cooper.test.ts
// …
    boards: { ...config.boards, database: ':memory:', port: boardsPort, publicUrl: boardsUrl, authPublicUrl: authUrl },
    backoffice: { ...config.backoffice, database: ':memory:', port: 0, authPublicUrl: authUrl },
  }
}
// …
```

Without it, the test would open the backoffice on port 3003 and its file database.

## Check it

The gate:

```sh
bun install && bun check && bun test cooper/ && bun run lint && bun run cooper:build
```

The backoffice's own tests:

```sh
bun test cooper/backend/contexts/backoffice
```

```text
 13 pass
 0 fail
 59 expect() calls
Ran 13 tests across 5 files.
```

Start the server. It now serves three contexts:

```sh
bun cooper/backend/index.ts
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
backoffice listening on http://localhost:3003/
```

In another terminal, the backoffice is up, and its API wants someone signed in:

```sh
curl -s localhost:3003/api/health
curl -i localhost:3003/api/staff
```

```text
{"status":"ok"}
HTTP/1.1 401 Unauthorized
Content-Type: application/json;charset=utf-8
…

{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

Signing in sends the browser to auth, as the client `backoffice`:

```sh
curl -i "localhost:3003/api/session/sign-in?returnTo=/"
```

```text
HTTP/1.1 302 Found
Location: http://localhost:3001/oauth/authorize?response_type=code&client_id=backoffice&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fsession%2Fcallback&code_challenge=…&code_challenge_method=S256&state=…
Set-Cookie: cooper_backoffice_sign_in=…; Path=/api/session; Max-Age=600; HttpOnly; SameSite=Lax
…
```

The rest of the way goes through auth's sign-in page, and nobody is staff yet: the
seed makes the first staff account in the next chapter, with the backoffice's
frontend. Until then, `backoffice-sign-in.test.ts` walks it end to end.

## What to remember

- A context that reads others is handed **their modules' use cases, as a `Pick`**:
  never a base, never a store. Its deps type is the list of what it depends on, in
  plain sight, and the lint's `uses` says which contexts it may import.
- **One group, one check**: a group with prefix `''` whose middleware runs
  `staff.enter` puts the check in front of every route, and no route can forget it.
  Asking auth on every request makes an access taken away count at once.
- **Compose reads a page at a time**: a page of one for a total, `getMany` and
  `countBy…` for a whole page in one call, never one call per row. A context that
  others read from offers its reads in batches.
- **Writing into another context goes through its use cases**, which are its API: its
  own rules hold there (auth checks again that the caller is staff). Keep each such
  write one save in one store.
- A second web app signs in through auth like the first: **`WebSession_Module`, with
  its own client and its own cookies**. auth refuses whoever has no access at signing
  in; the app's own check refuses whoever lost it since.

Next: [Dead jobs and analytics](./26-dead-jobs-and-analytics).
