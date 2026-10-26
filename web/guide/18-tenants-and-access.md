# Tenants and access

boards works in workspaces: every board, column and card has a `workspaceId`, and
chapter 4's scopes make sure a request only sees its own. But nothing in cooper says
what a workspace is, who made it, or who may enter it. boards still asks `FakeAuth`,
told by hand in `open-contexts.ts` that Ana and Carl are in acme and Bea in globex.

That knowledge belongs to auth, the context that knows who someone is. This chapter
gives auth two modules:

- **`tenant`**: the workspaces themselves. auth calls them tenants, because auth
  serves several products and a tenant is whatever a product divides its customers
  into; boards keeps calling them workspaces. Whoever makes one is its single admin.
- **`access`**: who may enter which product, and where. An access is a person, a
  product and a tenant: Ana may enter `cooper` in Acme. Or a person and a product with
  no tenant at all (`tenantId` null): the staff may enter the whole `backoffice`.

Two of their rules are new kinds of rule. Making a workspace gives its maker the
admin access **in the same request**, although that is a write to another module.
And an access is given **once**, however many give it at the same moment, which the
version of a row cannot protect: the second row is new, it has no version to compare.
A unique index in a new migration does, and the use case learns what to do when it
answers `DuplicateValue`.

The staff will look accounts and workspaces up from the backoffice (chapter 25). So
`user` and `tenant` each get a `list` that takes a filter from a client, closed with
`defineFilter`.

Nothing here is served over HTTP yet: boards starts asking auth in [chapter
20](./20-wiring-contexts), and the routes come with the frontends. The tests drive the
modules directly.

## The tables

Two migrations, next to chapter 17's `00001_user` and `00002_session`. The workspaces
first. A deleted workspace keeps its row, stamped with `deleted_at`: other contexts
may still hold its id, in what they kept of it.

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00003_tenant_up.sql
-- The workspaces. A deleted one keeps its row (deleted_at): its id may still be named
-- by what other contexts kept of it.
CREATE TABLE tenant (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX tenant_created_by ON tenant (created_by);
```

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00003_tenant_down.sql
DROP TABLE tenant;
```

The accesses. `tenant_id` may be null: an access to the whole product. Two indexes for
the two ways they are read: someone's accesses to a product (`check`, on every
request that enters), and a tenant's members by role (its admin).

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00004_access_up.sql
-- Who may enter each product, for one tenant (tenant_id) or for all of it (null). One
-- admin per tenant: the access module checks it after each save, in its transaction.
CREATE TABLE access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  tenant_id TEXT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX access_user ON access (user_id, product_id);
CREATE INDEX access_tenant ON access (tenant_id, role);
```

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00004_access_down.sql
DROP TABLE access;
```

There is no unique index yet on who has which access. It comes in its own migration,
once you have seen the race it closes.

## A product is a reference: `product.find`

An access names a product by its id, and `access` must refuse one that does not
exist: `nope` is not a product. Chapter 17's products live in code, in the `product`
module, which is the only one that knows them.

A use case checks the ids its input points at with `this.resolveRefs(ids, finders)`.
For each key it asks the finder given for it, and throws `ReferenceNotFound` (a 400,
`reference_not_found`, chapter 3) for an id the finder does not find. A finder is
anything with a `find({ id: [...] })` that gives back what it found, each with an `id`
and a `name`; a `null` id means "none" and is not looked up. A module with a table has
that `find` already through its repository; `product` has no table, so add one after
`get`:

```ts
// cooper/backend/contexts/auth/modules/product/product.module.ts
  /** For `resolveRefs`: the products with these ids, as any module's `find` gives them. */
  @UseCase()
  async find(criteria: { id: string[] }): Promise<ProductDTO[]> {
    return this.products.filter(product => criteria.id.includes(product.id)).map(product => structuredClone(product))
  }
```

`resolveRefs` checks that the reference exists, no more. A check that needs more (the
person is a member of this workspace) is a question of its own, as `access` asks
below.

## The access module

An access is small: a user, a product, a tenant or none, and a role. A tenant has one
`admin`, who made it, and any number of `member`s. Create
`cooper/backend/contexts/auth/modules/access/access.schema.ts`. Beside the DTO it has
two inputs: what someone asks for when they give an access (`grant`: the role is
always `member`), and what auth gives on its own, with the role (`admit`).

```ts
// cooper/backend/contexts/auth/modules/access/access.schema.ts
import { z } from 'zod'

/** A tenant's single admin (who made it), or one of its members. */
export const AccessRoleSchema = z.enum(['admin', 'member'])

/**
 * Someone may enter a product: for one tenant (a member of a workspace of `cooper`)
 * or for all of it (`tenantId` null: the staff of `backoffice`).
 */
export const AccessSchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  productId: z.string().min(1),
  /** The tenant it is for; null when it is for the whole product. */
  tenantId: z.string().nullable(),
  role: AccessRoleSchema,
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** Whose access to what: a user, a product, and a tenant or none. */
export const AccessGrantSchema = z.object({
  userId: z.uuidv7(),
  productId: z.string().min(1),
  tenantId: z.string().min(1).nullable().default(null),
})

/** An access given by auth itself, once it checked who may have it: with its role. */
export const AccessAdmitSchema = AccessGrantSchema.extend({ role: AccessRoleSchema })

export type AccessRole = z.infer<typeof AccessRoleSchema>
export type AccessDTO = z.infer<typeof AccessSchema>
export type AccessGrantDTO = z.input<typeof AccessGrantSchema>
export type AccessAdmitDTO = z.input<typeof AccessAdmitSchema>
```

The entity, `access.ts`. It is granted, and revoked; nothing else happens to an
access. Revoking deletes it outright: the repository below has no `softDelete`, so its
row goes. An access is a key to a door, not history.

```ts
// cooper/backend/contexts/auth/modules/access/access.ts
import { Entity, type EntityInput } from 'newt/core'
import { Access_Granted } from './events/access-granted'
import { Access_Revoked } from './events/access-revoked'
import { AccessSchema, type AccessDTO, type AccessRole } from './access.schema'

export * from './access.schema'

/** Someone's access to a product, for one of its tenants or for all of it. */
export class Access extends Entity<typeof AccessSchema> {

  private constructor(input: EntityInput<AccessDTO>, isNew: boolean) {
    super(AccessSchema, input, isNew)
  }

  static fromDTO(dto: AccessDTO & { version: number }): Access {
    return new Access(dto, false)
  }

  static grant(input: { userId: string, productId: string, tenantId: string | null, role: AccessRole }): Access {
    const access = new Access(input, true)
    access.trackEvent(new Access_Granted(access.toDTO()))
    return access
  }

  get userId(): string {
    return this.data.userId
  }

  get productId(): string {
    return this.data.productId
  }

  get tenantId(): string | null {
    return this.data.tenantId
  }

  get role(): AccessRole {
    return this.data.role
  }

  /** From then on it opens nothing. Accesses are not history: its row goes. */
  revoke(): void {
    this.markAsDeleted()
    this.trackEvent(new Access_Revoked(this.toDTO()))
  }
}
```

Its two events, in `events/`:

```ts
// cooper/backend/contexts/auth/modules/access/events/access-granted.ts
import { now, type DomainEvent } from 'newt/core'
import type { AccessDTO } from '../access.schema'

/** Someone may now enter a product, for a tenant or for all of it. */
export class Access_Granted implements DomainEvent<AccessDTO> {
  static readonly eventName = 'access.granted'
  readonly name = Access_Granted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AccessDTO) {}
}
```

```ts
// cooper/backend/contexts/auth/modules/access/events/access-revoked.ts
import { now, type DomainEvent } from 'newt/core'
import type { AccessDTO } from '../access.schema'

/** Someone may no longer enter a product (or one of its tenants): the access as it was. */
export class Access_Revoked implements DomainEvent<AccessDTO> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AccessDTO) {}
}
```

Its errors, in `errors/`. Two are `NotFoundError`s on purpose. `NotAMember` is what
someone outside a workspace hears when they try to manage it: "there is no workspace",
a 404. A private thing never says it exists to someone who may not see it. Who is
inside but is not its admin hears `NotAdmin`, a 403: they know it exists already.

```ts
// cooper/backend/contexts/auth/modules/access/errors/access-not-found.ts
import { NotFoundError } from 'newt/core'

export class AccessNotFound extends NotFoundError {
  readonly code = 'access.not_found'
  constructor() {
    super('This person has no such access')
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/access/errors/not-a-member.ts
import { NotFoundError } from 'newt/core'

/** Whoever is not a member of a workspace is told it does not exist: a private thing never says it does. */
export class NotAMember extends NotFoundError {
  readonly code = 'access.not_a_member'
  constructor(tenantId: string) {
    super(`There is no workspace ${tenantId}`)
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/access/errors/not-admin.ts
import { ForbiddenError } from 'newt/core'

/** A member, or someone of the product, who may not manage who enters it. */
export class NotAdmin extends ForbiddenError {
  readonly code = 'access.not_admin'
  constructor() {
    super('Only an admin may do this')
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/access/errors/admin-not-revocable.ts
import { ConflictError } from 'newt/core'

/** A workspace keeps its admin for as long as it exists. */
export class AdminNotRevocable extends ConflictError {
  readonly code = 'access.admin_not_revocable'
  constructor() {
    super('The admin of a workspace cannot be removed from it')
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/access/errors/tenant-has-admin.ts
import { ConflictError } from 'newt/core'

/** A workspace has one admin, who made it: a second one is refused, however it came. */
export class TenantHasAdmin extends ConflictError {
  readonly code = 'access.tenant_has_admin'
  constructor(tenantId: string) {
    super(`The workspace ${tenantId} has an admin already`)
  }
}
```

It uses one other module, `product`:

```ts
// cooper/backend/contexts/auth/modules/access/access.deps.ts
import type { Product_Module } from '../product/product.module'

export interface Access_Deps {
  product: Product_Module
}
```

### One admin per tenant, under a guard

"A tenant has one admin" is a rule over several rows, as "a board name is unique in
its workspace" was in [chapter 6](./06-rules-over-rows). The tool is the same: a save
with an `after` hook that counts, in the transaction, after the writes, under a guard
that keeps any other save of the same rule out until it commits. The repository:

```ts
// cooper/backend/contexts/auth/modules/access/access.repository.ts
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { TenantHasAdmin } from './errors/tenant-has-admin'
import { Access, type AccessDTO } from './access'

export type AccessRow = AccessDTO & { version: number }

export class Access_Repository extends TableRepository<Access, AccessRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<AccessRow>('access'))
  }

  protected toEntity(row: AccessRow): Access {
    return Access.fromDTO(row)
  }

  /**
   * Saves new accesses, each one once, keeping every tenant they touch with one admin
   * at most. Each is guarded by its key, which only makes two saves of it wait for
   * each other: what refuses the second row (`DuplicateValue`) is the unique index
   * `access_once` of auth's migrations (SQLite's and Postgres'), on (user, product,
   * tenant) with a null tenant, the staff's, counted as a value. The table declares
   * no `unique`: SQL stores ignore it (their indexes say it), and the files store, the
   * only one that keeps it, lets a row with a null field share its value, so the
   * staff's accesses would go unguarded there. Any other SQL store needs that index
   * in its migrations.
   * The admins are checked after the writes, in their transaction, guarding each
   * tenant's admin, so two saves giving a tenant an admin at once cannot both succeed.
   */
  async persistKeepingOneAdmin(...accesses: Access[]): Promise<void> {
    const tenants = [...new Set(accesses.map(access => access.tenantId).filter(tenantId => tenantId !== null))]
    await this.save(accesses, access => this.write(access), {
      guard: [
        ...accesses.map(access => `access:${access.userId}:${access.productId}:${access.tenantId ?? ''}`),
        ...tenants.map(tenantId => `tenantAdmin:${tenantId}`),
      ],
      after: async () => {
        for (const tenantId of tenants) {
          if (await this.count({ tenantId, role: 'admin' }) > 1) throw new TenantHasAdmin(tenantId)
        }
      },
    })
  }
}
```

`persistKeepingOneAdmin` guards two kinds of key:

- `tenantAdmin:<tenant>`, for each tenant the save touches. Two saves giving Acme an
  admin at the same moment take turns, and the second one's `after` counts two admins
  and throws `TenantHasAdmin`, which rolls its save back.
- `access:<user>:<product>:<tenant>`, for each access. This one checks nothing in
  `after`: it only makes two saves of the same access wait for each other. What
  refuses the second one is the index of the next section.

The comment says why the table does not declare `unique` (chapter 6's board did). SQL
stores ignore that option, since their indexes say it, and the files store, the only
one that keeps it, lets two rows whose field is null share the value. The staff's
accesses have a null tenant, so on the files store they would go unguarded. The
index says it on every SQL store, null included.

### Given once: a unique index, and `DuplicateValue`

Two people give Bob access to Acme at the same moment. Both look for an existing
access, find none, and save a new row. Neither row has a version to conflict on:
both are new. The guard makes the second save wait for the first, then lets it write
its row. Nothing so far stops Bob from having two accesses to Acme.

A unique index does. Add a third migration:

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00005_access-once_up.sql
-- One access per person, product and tenant: two saves giving the same one at once
-- cannot both succeed. A null tenant (the whole product) counts as a value, so the
-- staff's access is kept once too.
CREATE UNIQUE INDEX access_once ON access (user_id, product_id, ifnull(tenant_id, ''));
```

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00005_access-once_down.sql
DROP INDEX access_once;
```

It is on an expression, `ifnull(tenant_id, '')`, not on the column. In SQL, two nulls
are never equal, so a plain `UNIQUE (user_id, product_id, tenant_id)` would let the
same person have the whole `backoffice` twice. Counting null as the empty string makes
the staff's access one value like any other.

Why a new migration, and not one more line in `00004_access`? Because `00004` may be
applied already, on your machine or on a server. A migration that has run is never
edited: newt keeps the checksum of each up script it applied, and refuses to go on
when one has changed since. A change to the schema is a new file, with its `down`.

With the index, the second row is refused **as it is written**, before `after` runs.
The store throws `DuplicateValue`, a `ConcurrencyConflict` of its own
(`duplicate_value`, 409). Chapter 6 let the use case run again on it, once, so that its
own check would find the board name taken and answer with its own error. Here running
again is not always possible, as the next section shows, and not needed either: an
access given twice is not an error, it is given. So the use case catches it.

### The module

`access.module.ts`:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
import { currentActor, DuplicateValue, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { Access, AccessAdmitSchema, AccessGrantSchema, type AccessAdmitDTO, type AccessDTO, type AccessGrantDTO } from './access'
import type { Access_Deps } from './access.deps'
import { Access_Repository } from './access.repository'
import { AccessNotFound } from './errors/access-not-found'
import { AdminNotRevocable } from './errors/admin-not-revocable'
import { NotAMember } from './errors/not-a-member'
import { NotAdmin } from './errors/not-admin'
import { Access_Granted } from './events/access-granted'
import { Access_Revoked } from './events/access-revoked'

/** A page of accesses as a page of their DTOs. */
const toDTOs = (found: Page<Access>): Page<AccessDTO> => mapPage(found, access => access.toDTO())

/**
 * Who may enter each product: the members of each workspace of `cooper`, and the
 * staff of `backoffice`. It is asked every time (`check`), so an access taken away
 * counts at once.
 */
export class Access_Module extends Module {

  static initialize(base: AuthBase, deps: Access_Deps): Access_Module {
    return new Access_Module(base, new Access_Repository(base), deps)
  }

  readonly events

  private constructor(base: AuthBase, private readonly repo: Access_Repository, private readonly deps: Access_Deps) {
    super('access', base.invocations)
    this.events = eventsOf(base.bus, { granted: Access_Granted, revoked: Access_Revoked })
  }

  /**
   * Someone's access to a product, for a tenant or (null) for all of it; null when they
   * have none. What every context asks before letting someone in.
   */
  @UseCase()
  async check(userId: string, productId: string, tenantId: string | null = null): Promise<AccessDTO | null> {
    return (await this.repo.first({ userId, productId, tenantId }))?.toDTO() ?? null
  }

  /** The members of a tenant, the oldest first: its admin leads. */
  @UseCase()
  async listForTenant(tenantId: string, page: PageRequest): Promise<Page<AccessDTO>> {
    return toDTOs(await this.repo.page({ tenantId }, page))
  }

  /** Who may enter the whole of a product (no tenant), the oldest first: the staff of `backoffice`. */
  @UseCase()
  async listForProduct(productId: string, page: PageRequest): Promise<Page<AccessDTO>> {
    return toDTOs(await this.repo.page({ productId, tenantId: null }, page))
  }

  /** Someone's accesses, the newest first; to one product only when it is given. */
  @UseCase()
  async listForUser(userId: string, page: PageRequest, productId?: string): Promise<Page<AccessDTO>> {
    return toDTOs(await this.repo.page({ userId, productId }, page, { newestFirst: true }))
  }

  /**
   * The signed-in person gives someone access: a tenant's admin to the tenant, someone
   * of the staff to the whole product. Given twice, it is given once.
   */
  @UseCase()
  async grant(input: AccessGrantDTO): Promise<AccessDTO> {
    const { userId, productId, tenantId } = AccessGrantSchema.parse(input)
    await this.resolveRefs({ productId }, { productId: this.deps.product })
    await this.assertManages(productId, tenantId)
    return this.give({ userId, productId, tenantId, role: 'member' })
  }

  /**
   * The signed-in person takes someone's access away: a tenant's admin, or a member
   * leaving it; someone of the staff, for the whole product. The admin is never
   * removed: a tenant keeps it while it exists.
   */
  @UseCase()
  async revoke(input: AccessGrantDTO): Promise<void> {
    const { userId, productId, tenantId } = AccessGrantSchema.parse(input)
    const leaving = tenantId !== null && userId === currentActor().userId
    if (!leaving) await this.assertManages(productId, tenantId)
    const access = await this.resolve(() => this.repo.find({ userId, productId, tenantId }), () => new AccessNotFound())
    if (access.role === 'admin') throw new AdminNotRevocable()
    access.revoke()
    await this.repo.persist(access)
  }

  /**
   * An access auth gives on its own, once it checked who may have it: a new tenant's
   * admin (its creator), the member an accepted invitation makes, the first staff a
   * script makes. Safe to run again, even at the same time: given twice, it is given
   * once, and the second time answers with it. A tenant never gets a second admin,
   * whoever asks (the save checks it).
   */
  @UseCase()
  async admit(input: AccessAdmitDTO): Promise<AccessDTO> {
    const { userId, productId, tenantId, role } = AccessAdmitSchema.parse(input)
    await this.resolveRefs({ productId }, { productId: this.deps.product })
    return this.give({ userId, productId, tenantId, role })
  }

  /**
   * A tenant is gone: nobody enters it any more, its admin neither. What its deletion
   * calls, and its worker after it; safe to run again.
   */
  @UseCase()
  async revokeTenant(tenantId: string): Promise<void> {
    const accesses = await this.repo.find({ tenantId })
    for (const access of accesses) access.revoke()
    await this.repo.persist(...accesses)
  }

  private async give(input: { userId: string, productId: string, tenantId: string | null, role: 'admin' | 'member' }): Promise<AccessDTO> {
    const { userId, productId, tenantId } = input
    const existing = await this.repo.first({ userId, productId, tenantId })
    if (existing) return existing.toDTO()
    const access = Access.grant(input)
    try {
      await this.repo.persistKeepingOneAdmin(access)
    } catch (error) {
      // Given by another save at the same time (a tenant's admin, by the request that
      // made it and by its worker): given once, and this one gives what is there. Run
      // again, it would find it; but `tenant.create`, which calls it, never runs again.
      const given = error instanceof DuplicateValue ? await this.repo.first({ userId, productId, tenantId }) : undefined
      if (!given) throw error
      return given.toDTO()
    }
    return access.toDTO()
  }

  /**
   * Whether the signed-in person manages who enters: a tenant's admin, its own; the
   * staff, the whole product. Someone outside a tenant is told it does not exist.
   */
  private async assertManages(productId: string, tenantId: string | null): Promise<void> {
    const mine = await this.repo.first({ userId: currentActor().userId, productId, tenantId })
    if (tenantId !== null && !mine) throw new NotAMember(tenantId)
    if (!mine || (tenantId !== null && mine.role !== 'admin')) throw new NotAdmin()
  }
}
```

The use cases, from the top:

- **`check`** is what every context will ask before letting someone in: this person's
  access to this product, in this tenant (or the whole product), or null. It is asked
  on every request, never kept, so an access taken away counts at once.
- **`listForTenant`, `listForProduct`, `listForUser`** list by tenant, by product with
  no tenant (the staff) and by person. `repo.page` goes by id, the oldest first, so a
  tenant's admin, its first access, leads its list.
- **`grant`** is a person giving an access, as the signed-in actor: a workspace's
  admin to their workspace, someone of the staff to the whole product. It resolves the
  product, checks that the actor manages it (`assertManages`), and gives a `member`
  access.
- **`revoke`** takes one away. The admin of the workspace may, and so may a member
  taking their own (`leaving`): leaving needs nobody's permission. The admin's own
  access is never taken: a workspace keeps its admin while it exists.
- **`admit`** is auth giving an access on its own, once something else has decided who
  may have it: the maker of a new workspace (below), the member an accepted invitation
  makes (chapter 19), the first staff a script makes. It checks no actor, so no route
  serves it: only auth's own code calls it.
- **`revokeTenant`** takes every access to a tenant away, for its deletion.

`grant` and `admit` share `give`, which is where "once" lives. It looks for the access
first, and answers it if it is there: giving twice in a row is giving once. Then it
saves. If the save throws `DuplicateValue`, another save gave the same access in the
meantime; `give` reads it and answers it, as if it had found it in the first place.
Any other error, or a `DuplicateValue` with nothing found behind it, goes on up.

That makes `admit` safe to run again, even at the same time as another run of itself:
exactly what a worker needs, and what the next module relies on.

Look at the order inside one save, too. If a second admin is admitted for Acme, its
row is new (another user), the index has nothing against it, and `after` counts two
admins: `TenantHasAdmin`. If Acme's own admin is admitted twice at once, the index
refuses the second row before `after` counts anything, and `give` answers the admin
that is there. Without the index, that second row would get as far as `after`, and the
same admin, admitted twice, would be refused as a second admin. You will see exactly
that when you take the index away, at the end of the chapter.

## The tenant module

`cooper/backend/contexts/auth/modules/tenant/tenant.schema.ts`. A workspace has a name
and its maker, `createdBy`, its single admin.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.schema.ts
import { z } from 'zod'
import { defineFilter } from 'newt/contract'

/**
 * A workspace of `cooper`: every other context keeps what it needs of it by its id
 * (boards calls it a workspace). Its admin is who made it, and only them.
 */
export const TenantSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1, 'Give the workspace a name').max(60, 'Use at most 60 characters'),
  /** Who made it: its single admin. */
  createdBy: z.uuidv7(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const TenantCreateSchema = TenantSchema.pick({ name: true })
export const TenantRenameSchema = TenantSchema.pick({ name: true })

/** What the staff may look workspaces up by: these fields, these operators, nothing else. */
export const TenantFilter = defineFilter({
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  admin: { field: 'createdBy', value: z.string(), ops: ['eq', 'in'] },
  created: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })

export type TenantDTO = z.infer<typeof TenantSchema>
export type TenantCreateDTO = z.input<typeof TenantCreateSchema>
export type TenantRenameDTO = z.input<typeof TenantRenameSchema>
/** A search of workspaces as a client sends it. */
export type TenantFilterDTO = z.infer<typeof TenantFilter.schema>
```

### What the staff may look workspaces up by: `TenantFilter`

The backoffice will list every workspace, and its staff will filter: by name, by
admin, by when they were made. A filter comes from a client, so it is closed, as
`CardFilter` was in [chapter 15](./15-kysely): `defineFilter` gives each public name
(`admin`) the field it points at (`createdBy`), the operators it allows, and limits on
how deep groups nest and how many conditions a filter has. `TenantFilter.schema`
parses what a client sends, refusing any field or operator not declared, and
`TenantFilter.toCriteria` turns what passed into criteria for the repository. `id`,
`deletedAt` and `version` are not in the list, so no client filters on them.

The entity, `tenant.ts`. It is created, renamed and deleted, and each tells an event:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.ts
import { Entity, type EntityInput } from 'newt/core'
import { Tenant_Created } from './events/tenant-created'
import { Tenant_Deleted } from './events/tenant-deleted'
import { Tenant_Renamed } from './events/tenant-renamed'
import { TenantSchema, type TenantDTO } from './tenant.schema'

export * from './tenant.schema'

/** A workspace, and who made it: its admin. */
export class Tenant extends Entity<typeof TenantSchema> {

  private constructor(input: EntityInput<TenantDTO>, isNew: boolean) {
    super(TenantSchema, input, isNew)
  }

  static fromDTO(dto: TenantDTO & { version: number }): Tenant {
    return new Tenant(dto, false)
  }

  static create(input: { name: string, createdBy: string }): Tenant {
    const tenant = new Tenant(input, true)
    tenant.trackEvent(new Tenant_Created(tenant.toDTO()))
    return tenant
  }

  get createdBy(): string {
    return this.data.createdBy
  }

  rename(name: string): void {
    this.change({ name })
    const changes = this.getChanges()
    if (changes) this.trackEvent(new Tenant_Renamed({ dto: this.toDTO(), changes, previous: this.getPrevious()! }))
  }

  /** Deleted softly: its row stays, for whatever other contexts kept of it. */
  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Tenant_Deleted(this.toDTO()))
  }
}
```

The events, in `events/`. `tenant.created` and `tenant.deleted` carry the whole
workspace; other contexts keep what they need of it from them. These are the events
boards' sagas of [chapter 14](./14-sagas) react to: its welcome board on
`tenant.created`, its purge on `tenant.deleted` (chapter 20 connects them). In auth,
`tenant.deleted` starts a saga of its own, below.

```ts
// cooper/backend/contexts/auth/modules/tenant/events/tenant-created.ts
import { now, type DomainEvent } from 'newt/core'
import type { TenantDTO } from '../tenant.schema'

/** A new workspace: boards gives it a first board from this. */
export class Tenant_Created implements DomainEvent<TenantDTO> {
  static readonly eventName = 'tenant.created'
  readonly name = Tenant_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: TenantDTO) {}
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/events/tenant-renamed.ts
import { now, type DomainEvent } from 'newt/core'
import type { TenantDTO } from '../tenant.schema'

/** The whole workspace as it is now, the fields that changed (`changes`) and what they were (`previous`). */
type TenantChange = { dto: TenantDTO, changes: Partial<TenantDTO>, previous: Partial<TenantDTO> }

export class Tenant_Renamed implements DomainEvent<TenantChange> {
  static readonly eventName = 'tenant.renamed'
  readonly name = Tenant_Renamed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: TenantChange) {}
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/events/tenant-deleted.ts
import { now, type DomainEvent } from 'newt/core'
import type { TenantDTO } from '../tenant.schema'

/**
 * A workspace was deleted: the start of a saga. auth takes every access to it away
 * once more (`delete` already did, in the request); boards deletes its boards. Each
 * from a worker.
 */
export class Tenant_Deleted implements DomainEvent<TenantDTO> {
  static readonly eventName = 'tenant.deleted'
  readonly name = Tenant_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: TenantDTO) {}
}
```

The errors:

```ts
// cooper/backend/contexts/auth/modules/tenant/errors/tenant-not-found.ts
import { NotFoundError } from 'newt/core'

export class TenantNotFound extends NotFoundError {
  readonly code = 'tenant.not_found'
  constructor(id: string) {
    super(`There is no workspace ${id}`)
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/errors/not-tenant-admin.ts
import { ForbiddenError } from 'newt/core'

/** A member who is not the workspace's admin, trying what only the admin may do. */
export class NotTenantAdmin extends ForbiddenError {
  readonly code = 'tenant.not_admin'
  constructor() {
    super('Only the admin of the workspace may do this')
  }
}
```

The repository deletes softly, as chapter 2's boards did: a deleted workspace keeps
its row, and no `find`, `first`, `page` or `count` sees it.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.repository.ts
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Tenant, type TenantDTO } from './tenant'

export type TenantRow = TenantDTO & { version: number, deletedAt: string | null }

export class Tenant_Repository extends TableRepository<Tenant, TenantRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<TenantRow>('tenant'), { softDelete: true })
  }

  protected toEntity(row: TenantRow): Tenant {
    return Tenant.fromDTO(row)
  }
}
```

The module knows `access`, and is told which product its tenants belong to. auth
serves more than one product; the workspaces are `cooper`'s.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.deps.ts
import type { Access_Module } from '../access/access.module'

export interface Tenant_Deps {
  access: Access_Module
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant-options.ts
export type Tenant_Options = {
  /** The product whose workspaces the tenants are, and whose access makes someone a member: `cooper`. */
  productId: string
}
```

### Its workers

Two `handler` subscriptions, each with its queue named after what it does
(`<module>.<useCase>.on.<event>`), as in [chapter 11](./11-reacting). Each event's job
is written in the same transaction as the workspace, and runs until it completes.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.workers.ts
import type { Tenant_Module } from './tenant.module'

/**
 * What a workspace's own events set going, in auth. Both write to `access`, which only
 * a worker may do: a job runs again until it completes, so each one converges.
 */
export function registerTenantWorkers(tenants: Tenant_Module): void {
  // Its admin, in case the request that made it stopped before giving it.
  tenants.events.created.subscribe(tenant => tenants.ensureAdmin(tenant), {
    strategy: 'handler',
    queue: 'tenant.ensureAdmin.on.tenant.created',
  })
  // A step of its deletion: nobody enters it any more.
  tenants.events.deleted.subscribe(tenant => tenants.removeAccesses(tenant.id), {
    strategy: 'handler',
    queue: 'tenant.removeAccesses.on.tenant.deleted',
  })
}
```

- On `tenant.created`, `ensureAdmin` admits the maker as admin. The request already
  did (below); this is in case it stopped between its two saves.
- On `tenant.deleted`, `removeAccesses` takes every access to the workspace away. The
  request already did that too; this is in case it stopped, or someone was let in
  between the request's two saves.

Both call `access`'s use cases that are safe to run again: `admit` gives once,
`revokeTenant` finds nothing left the second time.

### The module

`tenant.module.ts`:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
import { currentActor, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { NotTenantAdmin } from './errors/not-tenant-admin'
import { TenantNotFound } from './errors/tenant-not-found'
import { Tenant_Created } from './events/tenant-created'
import { Tenant_Deleted } from './events/tenant-deleted'
import { Tenant_Renamed } from './events/tenant-renamed'
import { Tenant, TenantCreateSchema, TenantFilter, TenantRenameSchema, type TenantCreateDTO, type TenantDTO, type TenantRenameDTO } from './tenant'
import type { Tenant_Deps } from './tenant.deps'
import type { Tenant_Options } from './tenant-options'
import { Tenant_Repository, type TenantRow } from './tenant.repository'
import { registerTenantWorkers } from './tenant.workers'

/**
 * The workspaces of `cooper`. auth owns who they are and who belongs to each (through
 * `access`); every other context keeps what it needs of them, by their id, from
 * these events.
 */
export class Tenant_Module extends Module {

  static initialize(base: AuthBase, deps: Tenant_Deps, options: Tenant_Options): Tenant_Module {
    const module = new Tenant_Module(base, new Tenant_Repository(base), deps, options)
    registerTenantWorkers(module)
    return module
  }

  readonly events

  private constructor(
    base: AuthBase,
    private readonly repo: Tenant_Repository,
    private readonly deps: Tenant_Deps,
    private readonly options: Tenant_Options,
  ) {
    super('tenant', base.invocations)
    this.events = eventsOf(base.bus, { created: Tenant_Created, renamed: Tenant_Renamed, deleted: Tenant_Deleted })
  }

  /**
   * A new workspace, made by the signed-in person, who is its admin. It writes to
   * `access` without being a worker, on purpose: whoever makes a workspace enters it
   * the moment it answers. The workspace is saved first and its admin after; should
   * that second save fail, the worker of `tenant.created` (`ensureAdmin`) gives it;
   * whichever of the two gives it second finds it given.
   * It never runs again on a conflict: it would make a second workspace.
   */
  @UseCase({ writesTo: ['access'], retryOnConflict: false })
  async create(input: TenantCreateDTO): Promise<TenantDTO> {
    const { name } = TenantCreateSchema.parse(input)
    const tenant = Tenant.create({ name, createdBy: currentActor().userId })
    await this.repo.persist(tenant)
    await this.admitAdmin(tenant.toDTO())
    return tenant.toDTO()
  }

  /** For contexts that already checked who may see it (a member, the staff). */
  @UseCase()
  async get(tenantId: string): Promise<TenantDTO> {
    return (await this.load(tenantId)).toDTO()
  }

  /** The ones with these ids, in no order; a deleted one, or an id of none, is not there. */
  @UseCase()
  async getMany(ids: string[]): Promise<TenantDTO[]> {
    if (ids.length === 0) return []
    return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(tenant => tenant.toDTO())
  }

  /** Every workspace, newest first, as the staff look them up: only what `TenantFilter` allows. */
  @UseCase()
  async list(filter: unknown, page: PageRequest): Promise<Page<TenantDTO>> {
    const criteria = filter === undefined ? {} : TenantFilter.toCriteria<TenantRow>(TenantFilter.schema.parse(filter))
    const found = await this.repo.page(criteria, page, { newestFirst: true })
    return mapPage(found, tenant => tenant.toDTO())
  }

  /** The workspaces someone belongs to, the ones they joined last first. */
  @UseCase()
  async listForUser(userId: string, page: PageRequest): Promise<Page<TenantDTO>> {
    const accesses = await this.deps.access.listForUser(userId, page, this.options.productId)
    const tenants = new Map((await this.getMany(accesses.items.flatMap(access => access.tenantId ?? []))).map(tenant => [tenant.id, tenant]))
    // A workspace deleted while this read, or whose accesses its deletion failed to take away (its worker will), is left out.
    return mapPage(accesses, access => tenants.get(access.tenantId!))
  }

  /** Only its admin renames it. */
  @UseCase()
  async rename(tenantId: string, input: TenantRenameDTO): Promise<TenantDTO> {
    const { name } = TenantRenameSchema.parse(input)
    await this.assertAdmin(tenantId)
    const tenant = await this.load(tenantId)
    tenant.rename(name)
    await this.repo.persist(tenant)
    return tenant.toDTO()
  }

  /**
   * Only its admin deletes it. The rest follows from `tenant.deleted`, each part from
   * a worker: its boards in boards, its accesses once more.
   * Its accesses also go at once, after it: it writes to `access` without being a
   * worker, on purpose, so that nobody enters it from the moment it answers. Should
   * that second save fail, its worker takes them away. It never runs again on a
   * conflict: it would find the workspace deleted already.
   */
  @UseCase({ writesTo: ['access'], retryOnConflict: false })
  async delete(tenantId: string): Promise<void> {
    await this.assertAdmin(tenantId)
    const tenant = await this.load(tenantId)
    tenant.delete()
    await this.repo.persist(tenant)
    await this.deps.access.revokeTenant(tenantId)
  }

  /** A new workspace has its admin: what its worker calls, in case `create` stopped halfway. Safe to run again. */
  @UseCase()
  async ensureAdmin(tenant: TenantDTO): Promise<void> {
    await this.admitAdmin(tenant)
  }

  /**
   * A deleted workspace's accesses go: a step of its deletion, from a worker, in case
   * `delete` stopped halfway or someone entered it meanwhile. Safe to run again.
   */
  @UseCase()
  async removeAccesses(tenantId: string): Promise<void> {
    await this.deps.access.revokeTenant(tenantId)
  }

  private admitAdmin(tenant: TenantDTO) {
    return this.deps.access.admit({ userId: tenant.createdBy, productId: this.options.productId, tenantId: tenant.id, role: 'admin' })
  }

  private load(tenantId: string): Promise<Tenant> {
    return this.resolve(() => this.repo.find({ id: tenantId }), () => new TenantNotFound(tenantId))
  }

  /** The signed-in person is its admin. Who is not even a member is told it does not exist. */
  private async assertAdmin(tenantId: string): Promise<void> {
    const access = await this.deps.access.check(currentActor().userId, this.options.productId, tenantId)
    if (!access) throw new TenantNotFound(tenantId)
    if (access.role !== 'admin') throw new NotTenantAdmin()
  }
}
```

`get`, `getMany`, `list` and `listForUser` read. `get` checks no actor: it is for a
context that has already decided who may see the workspace. `listForUser` reads
someone's accesses to `cooper`, a page of them, and the workspaces they point at;
`mapPage` leaves out an item its function returns `undefined` for, so a workspace
deleted while this read is not in the page. `list` is the staff's: `filter` is
`unknown`, since it comes from a client, and `TenantFilter.schema.parse` is what gives
it a type, or a 400.

`rename` and `delete` belong to the admin. `assertAdmin` asks `access.check`: no
access at all is `TenantNotFound`, an access that is not the admin's is
`NotTenantAdmin`.

### `create`: a write to another module, and never twice

`create` saves the workspace, then gives its maker the admin access. Those are two
modules, and two transactions. The rule of [chapter 8](./08-two-people-one-card) says a
use case writes to another module only from a worker: if the second save failed, the
first would stay, and nothing would finish the work. `create` breaks the rule on
purpose, and says so where it is seen:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
  @UseCase({ writesTo: ['access'], retryOnConflict: false })
  async create(input: TenantCreateDTO): Promise<TenantDTO> {
```

**`writesTo: ['access']`.** Whoever makes a workspace must be able to enter it the
moment the answer arrives; a worker would give the access a moment later, and their
first request inside would be refused. So the request gives it itself. What if it
fails after the workspace is saved? Then the worker of `tenant.created`, whose job
was written with the workspace, gives it. The rule's reason still holds: the work is
always finished. It is just finished by the request in the usual case, and by the
worker when the request did not get there. Without `writesTo`, newt's write rule
refuses `access.admit`'s save, as chapter 14 showed.

**The race this creates.** The worker's job is written with the workspace. The context's
worker may claim it the moment that save commits, while the request is still calling
`admit`. Both give the same access at once. One save wins; the other's row is refused
by `access_once` as `DuplicateValue`, and `give` answers the access that is there. One
admin, both callers happy.

**`retryOnConflict: false`.** By default, a use case that meets a
`ConcurrencyConflict` runs again from the top, with everything it calls (chapter 8).
For `create`, the top is `Tenant.create`: a new workspace, with a new id, saved a
second time. The person would have two Acmes. So `create` says it never runs again,
and the comment says why. With it, nothing in its chain runs again either, `admit`
included: an `admit` called by `create` cannot count on running again to find the
access given. That is why `give` handles `DuplicateValue` itself, and does not leave it
to a second run.

`delete` follows the same pattern, the other way round: nobody may enter a deleted
workspace from the moment it answers, so it takes the accesses away in the request
(`writesTo: ['access']`), the worker of `tenant.deleted` is its fallback, and a second
run would find the workspace gone and answer 404 to a deletion that worked
(`retryOnConflict: false`).

## Accounts the staff can look up: `UserFilter`

The backoffice lists accounts too. In `user.schema.ts`, import `defineFilter` beside
`Email`:

```ts
// cooper/backend/contexts/auth/modules/user/user.schema.ts
import { defineFilter, Email } from 'newt/contract'
```

and declare what the staff may filter accounts by, after `UserSignUpSchema`, with its
type after the others:

```ts
// cooper/backend/contexts/auth/modules/user/user.schema.ts
/** What the staff may look accounts up by: these fields, these operators, nothing else. */
export const UserFilter = defineFilter({
  email: { field: 'email', value: z.string(), ops: ['eq', 'ieq'] },
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  signedUp: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })

export type UserDTO = z.infer<typeof UserSchema>
export type UserSignUpDTO = z.input<typeof UserSignUpSchema>
/** A search of accounts as a client sends it. */
export type UserFilterDTO = z.infer<typeof UserFilter.schema>
```

`passwordHash` is a field of the row. It is not in the filter, so no client can ask
"the accounts whose hash starts with…". That is the point of a closed list: the
filter decides what can be asked, not the table.

In `user.module.ts`, the imports grow:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
import { Email, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
// …
import { User, UserFilter, UserSignUpSchema, type UserDTO, type UserSignUpDTO } from './user'
import { User_Repository, type UserRow } from './user.repository'
```

and `list` goes after `get`, the same shape as `tenant.list`:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
  /** Every account, newest first, as the staff look them up: only what `UserFilter` allows. */
  @UseCase()
  async list(filter: unknown, page: PageRequest): Promise<Page<UserDTO>> {
    const criteria = filter === undefined ? {} : UserFilter.toCriteria<UserRow>(UserFilter.schema.parse(filter))
    const found = await this.repo.page(criteria, page, { newestFirst: true })
    return mapPage(found, user => user.toDTO())
  }
```

## Wiring them in

`initialize-modules.ts` initializes the two modules, each after what it uses: `access`
after `product`, `tenant` after `access`. Import them:

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
import { Access_Module } from './modules/access/access.module'
import { Product_Module } from './modules/product/product.module'
import { PRODUCTS, WORKSPACES_PRODUCT, type ProductDTO } from './modules/product/product.schema'
import { Session_Module } from './modules/session/session.module'
import { Tenant_Module } from './modules/tenant/tenant.module'
import { User_Module } from './modules/user/user.module'
```

and add them to `initializeModules`. The tenants are those of `WORKSPACES_PRODUCT`,
`cooper`:

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
export function initializeModules(base: AuthBase, config: Auth_Config) {
  const product = Product_Module.initialize(base, { products: declaredProducts(config) })
  const user = User_Module.initialize(base)
  const session = Session_Module.initialize(base, { user, product }, { days: config.sessionDays })
  const access = Access_Module.initialize(base, { product })
  const tenant = Tenant_Module.initialize(base, { access }, { productId: WORKSPACES_PRODUCT })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { product, user, session, access, tenant, outbox }
}
```

Two comments say what auth now holds. In `auth.context.ts`:

```ts
// cooper/backend/contexts/auth/auth.context.ts
/**
 * Who someone is: accounts, workspaces (tenants), who may enter which app, and who
 * is signed in. It uses no other context.
 */
```

and in `config.ts`:

```ts
// cooper/backend/config.ts
  /** Who someone is: accounts, workspaces, who may enter what, and who is signed in. */
```

`Auth_Context.open` already runs every migration in `migrations/sqlite/`, so the three
new ones apply the next time it opens.

## The tests

`auth.test.ts` gets an actor for the use cases that need one, and a way to wait for
the workers. Add the imports:

```ts
// cooper/backend/contexts/auth/auth.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runAsActor } from 'newt/core'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Auth_Context } from './auth.context'
import type { UserDTO } from './modules/user/user.schema'
```

and the helpers, around `signUp`. `settled` waits until the jobs the commits wrote
have run (`jobs.idle()`, chapter 11); `as` runs a call as someone signed in on the web;
`page` is the page every list asks for.

```ts
// cooper/backend/contexts/auth/auth.test.ts
const modules = () => auth.modules
/** Until the background work is done: the jobs the commits wrote, run. */
const settled = () => auth.base.jobs.idle()
const signUp = (name: string, email = `${name.toLowerCase()}@cooper.test`) => modules().user.signUp({ email, name, password: 'a long password' })
const as = <T>(user: UserDTO, fn: () => Promise<T>) => runAsActor({ userId: user.id, via: 'web' }, fn)
const page = { size: 20 }
```

In `accounts`, after *opens a session at sign-up, unless the product takes no new
accounts* (before the test over HTTP), one for `user.list`. A filter on a field
`UserFilter` does not declare fails to parse: the use case's promise rejects with a
`ZodError`, so the test awaits it.

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('lists accounts newest first, with the filters it allows', async () => {
    await signUp('Ana')
    await signUp('Bob')
    const all = await modules().user.list(undefined, page)
    expect(all.items.map(user => user.name)).toEqual(['Bob', 'Ana'])
    const found = await modules().user.list({ field: 'email', op: 'ieq', value: 'BOB@cooper.test' }, page)
    expect(found.items.map(user => user.name)).toEqual(['Bob'])
    await expect(modules().user.list({ field: 'passwordHash', op: 'eq', value: 'x' }, page)).rejects.toMatchObject({ name: 'ZodError' })
  })
```

Then a new `describe`, at the end of the file. The first tests are the workspace's
life: made with its admin at once, the worker finding the admin there; renamed by its
admin only, with a 404 for an outsider and a 403 for a member; one admin who stays,
and members who are removed or leave.

```ts
// cooper/backend/contexts/auth/auth.test.ts
describe('workspaces', () => {
  test('makes its creator its admin at once, and lists each one\'s workspaces', async () => {
    const ana = await signUp('Ana')
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))

    expect(await modules().access.check(ana.id, 'cooper', acme.id)).toMatchObject({ role: 'admin' })
    expect((await modules().tenant.listForUser(ana.id, page)).items.map(tenant => tenant.name)).toEqual(['Acme'])
    await settled()
    // Its worker found the admin there already: still one.
    expect((await modules().access.listForTenant(acme.id, page)).total).toBe(1)
  })

  test('is renamed and deleted by its admin only; whoever is not a member is told it does not exist', async () => {
    const [ana, bob, eve] = [await signUp('Ana'), await signUp('Bob'), await signUp('Eve')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await modules().access.admit({ userId: bob.id, productId: 'cooper', tenantId: acme.id, role: 'member' })

    await expect(as(bob, () => modules().tenant.rename(acme.id, { name: 'Bob Inc' }))).rejects.toMatchObject({ code: 'tenant.not_admin' })
    await expect(as(eve, () => modules().tenant.rename(acme.id, { name: 'Eve Inc' }))).rejects.toMatchObject({ code: 'tenant.not_found' })
    expect(await as(ana, () => modules().tenant.rename(acme.id, { name: 'Acme Corp' }))).toMatchObject({ name: 'Acme Corp' })
  })

  test('keeps one admin, who is never removed; a member may be removed or leave', async () => {
    const [ana, bob, cai] = [await signUp('Ana'), await signUp('Bob'), await signUp('Cai')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))

    await expect(modules().access.admit({ userId: bob.id, productId: 'cooper', tenantId: acme.id, role: 'admin' })).rejects.toMatchObject({ code: 'access.tenant_has_admin' })
    await expect(as(ana, () => modules().access.revoke({ userId: ana.id, productId: 'cooper', tenantId: acme.id }))).rejects.toMatchObject({ code: 'access.admin_not_revocable' })

    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await as(ana, () => modules().access.grant({ userId: cai.id, productId: 'cooper', tenantId: acme.id }))
    await expect(as(bob, () => modules().access.revoke({ userId: cai.id, productId: 'cooper', tenantId: acme.id }))).rejects.toMatchObject({ code: 'access.not_admin' })
    await as(ana, () => modules().access.revoke({ userId: cai.id, productId: 'cooper', tenantId: acme.id }))
    await as(bob, () => modules().access.revoke({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    expect((await modules().access.listForTenant(acme.id, page)).items.map(access => access.userId)).toEqual([ana.id])
  })
```

The next two are the races. Three gives of the same access at once, two by the admin
and one by auth itself, leave Bob one: Acme has two accesses, its admin's and Bob's. Two
admits of the same staff access, with no tenant, leave one as well: that is the
`ifnull` of the index. Then the race of `create` and its worker, staged: a
`fire-and-forget` subscriber runs right after the workspace's save commits, in this
process, while `create` is still giving the admin, as the worker can in production.

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('gives an access once, however many give it at the same time', async () => {
    const [ana, bob, staff] = [await signUp('Ana'), await signUp('Bob'), await signUp('Staff')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    const bobIn = { userId: bob.id, productId: 'cooper', tenantId: acme.id }
    await Promise.all([as(ana, () => modules().access.grant(bobIn)), as(ana, () => modules().access.grant(bobIn)), modules().access.admit({ ...bobIn, role: 'member' })])
    expect((await modules().access.listForTenant(acme.id, page)).total).toBe(2)

    const staffIn = { userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' as const }
    await Promise.all([modules().access.admit(staffIn), modules().access.admit(staffIn)])
    expect((await modules().access.listForProduct('backoffice', page)).total).toBe(1)
  })

  test('admits its admin again as a no-op, even at the same time as its worker', async () => {
    const ana = await signUp('Ana')
    // What the worker of `tenant.created` does, while the request still gives the admin.
    const workers: Promise<unknown>[] = []
    modules().tenant.events.created.subscribe(tenant => {
      workers.push(modules().access.admit({ userId: tenant.createdBy, productId: 'cooper', tenantId: tenant.id, role: 'admin' }))
    }, { strategy: 'fire-and-forget' })
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await Promise.all(workers)
    expect(workers).toHaveLength(1)
    expect((await modules().access.listForTenant(acme.id, page)).items).toMatchObject([{ userId: ana.id, role: 'admin' }])
  })
```

The staff's access to the whole `backoffice` is given by the staff, and a product that
does not exist is a `reference_not_found` from `resolveRefs`:

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('only the staff give the staff access to the backoffice', async () => {
    const [staff, ana] = [await signUp('Staff'), await signUp('Ana')]
    await modules().access.admit({ userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' })

    await expect(as(ana, () => modules().access.grant({ userId: ana.id, productId: 'backoffice' }))).rejects.toMatchObject({ code: 'access.not_admin' })
    await as(staff, () => modules().access.grant({ userId: ana.id, productId: 'backoffice' }))
    expect(await modules().access.check(ana.id, 'backoffice')).toMatchObject({ tenantId: null })
    await expect(as(staff, () => modules().access.grant({ userId: ana.id, productId: 'nope' }))).rejects.toMatchObject({ code: 'reference_not_found' })
  })
```

Deletion, twice. Once with its workers running: every access goes, each one telling
`access.revoked`. And once with the context's worker stopped (`jobs.stop()`), to show
that the request alone already lets nobody in: the worker is the fallback, not the
deletion. Last, the staff's list of every workspace, with its filter.

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('takes every access away once deleted, from its workers', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    const told: string[] = []
    modules().access.events.revoked.subscribe(access => { told.push(access.userId) }, { strategy: 'fire-and-forget' })

    await expect(as(bob, () => modules().tenant.delete(acme.id))).rejects.toMatchObject({ code: 'tenant.not_admin' })
    await as(ana, () => modules().tenant.delete(acme.id))
    await expect(modules().tenant.get(acme.id)).rejects.toMatchObject({ code: 'tenant.not_found' })
    await settled()

    expect((await modules().access.listForTenant(acme.id, page)).total).toBe(0)
    expect(told.sort()).toEqual([ana.id, bob.id].sort())
    expect((await modules().tenant.listForUser(ana.id, page)).items).toEqual([])
  })

  test('lets nobody in once deleted, before its workers run', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await settled()
    await auth.base.jobs.stop()

    await as(ana, () => modules().tenant.delete(acme.id))
    expect(await modules().access.check(bob.id, 'cooper', acme.id)).toBeNull()
    expect(await modules().access.check(ana.id, 'cooper', acme.id)).toBeNull()
    expect((await modules().access.listForUser(bob.id, page, 'cooper')).total).toBe(0)
    expect((await modules().tenant.listForUser(ana.id, page)).total).toBe(0)
  })

  test('lists every workspace newest first, with the filters it allows', async () => {
    const ana = await signUp('Ana')
    await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().tenant.create({ name: 'Globex' }))
    expect((await modules().tenant.list(undefined, page)).items.map(tenant => tenant.name)).toEqual(['Globex', 'Acme'])
    expect((await modules().tenant.list({ field: 'name', op: 'ieq', value: 'ACME' }, page)).items.map(tenant => tenant.name)).toEqual(['Acme'])
  })
})
```

In the first deletion test, `told` has both Ana and Bob: the request revoked both, and
the worker found nothing left to revoke. The admin is never revoked by `revoke`, but
`revokeTenant` takes hers too: the workspace is gone.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 89 pass
 0 fail
```

The tests about "once", alone:

```sh
bun test cooper/backend/contexts/auth -t 'once'
```

```text
 4 pass
 10 filtered out
 0 fail
```

Now see what the index does by taking it away. Move the two files of `00005_access-once`
out of `migrations/sqlite/` and run auth's tests (each test opens auth on a fresh
`:memory:` database, so the index is simply not made):

```sh
mkdir -p /tmp/away && mv cooper/backend/contexts/auth/migrations/sqlite/00005_access-once_* /tmp/away/
bun test cooper/backend/contexts/auth
```

Two tests fail (the output is trimmed here). The three gives at once leave four
accesses where there should be two: Ana's, and Bob's three times, since each give
looked before any saved, and the guard only made the saves take turns. And the race of
`create` and its worker ends in an error:

```text
error: expect(received).toBe(expected)
Expected: 2
Received: 4
(fail) workspaces > gives an access once, however many give it at the same time
TenantHasAdmin: The workspace 01a17961-7e4b-7678-a37b-b3446605ebbf has an admin already
(fail) workspaces > admits its admin again as a no-op, even at the same time as its worker
 12 pass
 2 fail
```

The second failure is the order of checks you saw in the access module: with no index,
the same admin's second row gets as far as `after`, which counts two admins. Put the
files back:

```sh
mv /tmp/away/00005_access-once_* cooper/backend/contexts/auth/migrations/sqlite/
```

Last, the index in a real database. Start the backend once (`bun
cooper/backend/index.ts`), so that auth applies its three new migrations to
`data/cooper-auth.db`, and stop it (Ctrl-C). Then ask SQLite:

```sh
sqlite3 data/cooper-auth.db ".indexes access"
```

```text
access_once                access_user              
access_tenant              sqlite_autoindex_access_1
```

and write the same staff access twice, behind the module's back:

```sh
sqlite3 data/cooper-auth.db "INSERT INTO access VALUES ('by-hand-1', 'nobody', 'backoffice', NULL, 'member', '', '', 1)"
sqlite3 data/cooper-auth.db "INSERT INTO access VALUES ('by-hand-2', 'nobody', 'backoffice', NULL, 'member', '', '', 1)"
```

```text
Error: stepping, UNIQUE constraint failed: index 'access_once' (19)
```

The first row gets in; the second, with the same null tenant, does not. Whatever
writes the table, the module or anything else, an access exists once. Remove the row
you wrote:

```sh
sqlite3 data/cooper-auth.db "DELETE FROM access WHERE user_id = 'nobody'"
```

## What to remember

- A use case that writes to another module outside a worker says so with `writesTo`,
  and a worker of the same event finishes the work if the request stops halfway. Use
  it when the person needs the result in the answer: whoever makes a workspace enters
  it at once.
- `retryOnConflict: false` is for a use case that must not run twice: `tenant.create`
  would make a second workspace. It turns retries off for its whole chain, so what it
  calls must handle its own conflicts.
- A rule over new rows has no version to protect it. A unique index refuses the
  second row as `DuplicateValue`; a use case for which "given twice" means "given
  once" catches it and answers what is there. Null is never equal to null in an
  index: say it as a value (`ifnull`) when it is one.
- A change to the schema is a new migration. One that has run is never edited.
- A filter a client sends is closed with `defineFilter`: public names, operators per
  field, limits. What is not declared, `passwordHash` say, cannot be asked.

Next: [Invitations and time](./19-invitations-and-time).
