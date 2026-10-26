# Invitations and time

Ana made Acme in [chapter 18](./18-tenants-and-access). Now she wants Bob in it. She
knows his email, not his account; he may not even have one yet. So she invites the
email: cooper sends Bob a link, and whoever signs in with that email and opens the
link becomes a member of Acme.

An invitation should not wait forever. Seven days after it was sent, the link opens
nothing. Sessions already work that way: each one ends after its days
([chapter 17](./17-auth)). Both read the time, and so far they read the real one. A
test that wants to see an invitation expire would have to wait a week.

There is a second thing time brings. An expired session is only closed when its
browser comes back, and many never do. Their rows pile up. Something should remove
them every night, without anyone asking.

This chapter makes time something auth is given, like its store: a **clock**. A test
gives its own and moves it. Then it adds the invitations, which expire by that clock,
and a **schedule**, an event the clock tells at three every night, whose worker
removes the expired sessions.

## Time is a dependency: the clock

newt's `Base` takes a `clock` among its options. A `Clock` is one method:

```ts
type Clock = { now(): Date }
```

Everything in the context that reads the time reads it from there:

- the `createdAt` and `updatedAt` its repositories write on every entity;
- when its jobs are due, and how long they wait between attempts;
- when its schedules are due (below);
- **`now()`**, from `newt/core`, in its use cases and handlers.

`now()` is what your code calls instead of `new Date()` or `Date.now()`. Inside a
use case it gives the time by the clock of the context running it; outside any, the
real time. Without a `clock`, a `Base` uses the real time, so nothing changes in
production. A test gives `{ now: () => new Date(time) }`, and moves `time` instead of
waiting.

`Auth_Context.open` takes a clock and hands it to its base. It also takes what its
modules are given from outside, `Auth_ModuleDeps`: the invitations send an email,
so auth needs a mailer now, as boards did in [chapter 12](./12-failures). Replace
`auth.context.ts`:

```ts
// cooper/backend/contexts/auth/auth.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
import { ServedContext } from '../../shared/served-context'
import { AuthBase } from './auth-base'
import type { Auth_Config } from './auth-config'
import { initializeModules, type Auth_ModuleDeps, type Auth_Modules } from './initialize-modules'

/**
 * Who someone is: accounts, workspaces (tenants), who may enter which app, and who
 * is signed in. It uses no other context.
 */
export class Auth_Context extends ServedContext {

  private constructor(auth: AuthBase, readonly modules: Auth_Modules, readonly config: Auth_Config) {
    super('auth', auth, config)
  }

  /**
   * Opening it brings its database up to date before any module reads it. The real
   * time tells its sessions and invitations when they expire, unless a test gives it a
   * `clock` of its own.
   */
  static async open(config: Auth_Config, deps: Auth_ModuleDeps, clock?: Clock): Promise<Auth_Context> {
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new AuthBase({ name: 'auth', store, clock })
    const modules = initializeModules(base, config, deps)
    return new Auth_Context(base, modules, config)
  }
}
```

The session is the first to read the time. Replace the import and the two places in
`session.ts` that read the real time:

```ts
// cooper/backend/contexts/auth/modules/session/session.ts
import { Entity, now, SecretToken, type EntityInput } from 'newt/core'
// …
  /** A new session for `userId`, and the token only its browser will hold. */
  static open(userId: string, days: number): { session: Session, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(now().getTime() + days * 24 * 60 * 60_000).toISOString()
    return { session: new Session({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }
// …
  isExpired(at = now()): boolean {
    return new Date(this.data.expiresAt) <= at
  }
```

`Session.open` and `isExpired` run inside the session module's use cases, so `now()`
is auth's clock there. The entity does not know where the time comes from, and needs
no parameter for it.

## Invitations

An invitation is a row of auth: who is invited (an email), to which workspace, by
whom, its status, and until when it waits. It gets a module of its own, `invitation`,
with the same files as every module.

### How long it waits

Add the setting to `config.ts`, in `auth`, after `sessionDays`:

```ts
// cooper/backend/config.ts
    sessionDays,
    /** `COOPER_INVITATION_DAYS`: how long an invitation to a workspace waits to be accepted. */
    invitationDays: Number(env.COOPER_INVITATION_DAYS ?? 7),
  },
```

### Its table

Create the migration `migrations/sqlite/00006_invitation_up.sql`:

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00006_invitation_up.sql
-- Invitations to a workspace. The hash of the link's token is set when the email
-- leaves, by a worker.
CREATE TABLE invitation (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  accepted_by TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX invitation_tenant ON invitation (tenant_id, status);
```

and its `00006_invitation_down.sql`:

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00006_invitation_down.sql
DROP TABLE invitation;
```

`token_hash` may be null, and is unique when it is not. The link's token is not made
when the invitation is created, but when its email leaves: you will see why below.
The index serves the two questions asked most: a workspace's pending invitations, and
whether an email already has one.

### Its schema

Create `modules/invitation/invitation.schema.ts`:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.schema.ts
import { z } from 'zod'
import { Email } from 'newt/contract'

export const InvitationStatusSchema = z.enum(['pending', 'accepted', 'revoked'])

/** Someone asked to join a workspace, by email, by its admin. */
export const InvitationSchema = z.object({
  id: z.uuidv7(),
  tenantId: z.uuidv7(),
  /** Who may accept it: whoever signs in with this email. */
  email: Email.schema,
  invitedBy: z.uuidv7(),
  status: InvitationStatusSchema,
  /** Who accepted it, once someone did. */
  acceptedBy: z.uuidv7().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const InvitationCreateSchema = z.object({
  email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
})

/** What the person who opens an invitation's link is shown before accepting it. */
export const InvitationReviewSchema = z.object({
  tenantId: z.uuidv7(),
  tenantName: z.string(),
  email: Email.schema,
  invitedByName: z.string(),
  /** Pending and not expired: it can still be accepted. */
  open: z.boolean(),
})

export type InvitationStatus = z.infer<typeof InvitationStatusSchema>
export type InvitationDTO = z.infer<typeof InvitationSchema>
export type InvitationCreateDTO = z.input<typeof InvitationCreateSchema>
export type InvitationReviewDTO = z.infer<typeof InvitationReviewSchema>
```

- `InvitationSchema` is what anyone is shown of an invitation. The email is an
  `Email` ([chapter 17](./17-auth)): lower case, so `BOB@cooper.test` and
  `bob@cooper.test` are one invitation.
- `InvitationCreateSchema` is what the admin sends: an email, with the messages a
  form shows.
- `InvitationReviewSchema` is what the link's page shows before anyone accepts:
  which workspace, for which email, who invited, and whether it can still be accepted.

### The entity

Create `modules/invitation/invitation.ts`:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.ts
import { z } from 'zod'
import { Email, Entity, now, SecretToken, type EntityInput } from 'newt/core'
import { Invitation_Accepted } from './events/invitation-accepted'
import { Invitation_Created } from './events/invitation-created'
import { Invitation_Revoked } from './events/invitation-revoked'
import { InvitationSchema, type InvitationStatus } from './invitation.schema'

export * from './invitation.schema'

/** The invitation as it is kept: what anyone sees, and the hash of its link's token. */
const InvitationEntitySchema = InvitationSchema.extend({
  /** Null until its email leaves: the token is made when it is sent, and only its hash kept. */
  tokenHash: z.string().nullable(),
})

export type InvitationEntityDTO = z.infer<typeof InvitationEntitySchema>

/** An invitation to join a workspace, sent by email, accepted by whoever signs in with that email. */
export class Invitation extends Entity<typeof InvitationEntitySchema, typeof InvitationSchema> {

  private constructor(input: EntityInput<InvitationEntityDTO>, isNew: boolean) {
    super(InvitationEntitySchema, input, isNew, InvitationSchema)
  }

  static fromDTO(dto: InvitationEntityDTO & { version: number }): Invitation {
    return new Invitation(dto, false)
  }

  /** A new one, pending for some days: the email as someone typed it becomes an `Email`. */
  static create(input: { tenantId: string, email: string, invitedBy: string, days: number }): Invitation {
    const { days, ...rest } = input
    const expiresAt = new Date(now().getTime() + days * 24 * 60 * 60_000).toISOString()
    const invitation = new Invitation({ ...rest, email: Email.from(rest.email), status: 'pending', acceptedBy: null, expiresAt, tokenHash: null }, true)
    invitation.trackEvent(new Invitation_Created(invitation.toDTO()))
    return invitation
  }

  get tenantId(): string {
    return this.data.tenantId
  }

  get email(): Email {
    return this.data.email
  }

  get invitedBy(): string {
    return this.data.invitedBy
  }

  get status(): InvitationStatus {
    return this.data.status
  }

  get expiresAt(): string {
    return this.data.expiresAt
  }

  /** Pending and not expired: it can still be accepted. */
  isOpen(at = now()): boolean {
    return this.data.status === 'pending' && new Date(this.data.expiresAt) > at
  }

  /**
   * A new token for its link, which only the email will carry: the one before, if
   * any, stops working. The store keeps its hash.
   */
  issueToken(): SecretToken {
    const token = SecretToken.generate()
    this.change({ tokenHash: SecretToken.hash(token) })
    return token
  }

  accept(userId: string): void {
    this.change({ status: 'accepted', acceptedBy: userId })
    this.trackEvent(new Invitation_Accepted(this.toDTO()))
  }

  revoke(): void {
    this.change({ status: 'revoked' })
    this.trackEvent(new Invitation_Revoked(this.toDTO()))
  }
}
```

- It keeps more than it shows, as the user does with its password's hash: the entity's
  schema extends `InvitationSchema` with `tokenHash`, and `toDTO()` gives
  `InvitationSchema`'s fields only.
- `create` sets `expiresAt` from `now()`, days ahead. `isOpen` compares with `now()`.
  Both run inside the module's use cases, so both go by auth's clock: a test that
  moves it a week ahead sees the invitation closed.
- `issueToken` makes a new `SecretToken` and keeps only its hash. Called again, it
  replaces the hash, so the link before stops working.
- `create`, `accept` and `revoke` each track their event.

### Its errors and events

Four errors, each with its code. Create them in `modules/invitation/errors/`:

```ts
// cooper/backend/contexts/auth/modules/invitation/errors/already-invited.ts
import { ConflictError } from 'newt/core'

/** This email has an invitation waiting already, or is a member. */
export class AlreadyInvited extends ConflictError {
  readonly code = 'invitation.already_invited'
  constructor(email: string) {
    super(`${email} is a member of this workspace or has an invitation waiting`)
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/invitation/errors/invitation-for-another-email.ts
import { ForbiddenError } from 'newt/core'

/** The link reached someone signed in with another email than the one invited. */
export class InvitationForAnotherEmail extends ForbiddenError {
  readonly code = 'invitation.another_email'
  constructor(email: string) {
    super(`This invitation is for ${email}: sign in with that email to accept it`)
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/invitation/errors/invitation-not-found.ts
import { NotFoundError } from 'newt/core'

/** No invitation has this id, or this link: one answer for both. */
export class InvitationNotFound extends NotFoundError {
  readonly code = 'invitation.not_found'
  constructor() {
    super('There is no such invitation')
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/invitation/errors/invitation-not-open.ts
import { ConflictError } from 'newt/core'

/** Accepted, revoked or expired: it opens nothing any more. */
export class InvitationNotOpen extends ConflictError {
  readonly code = 'invitation.not_open'
  constructor() {
    super('This invitation was accepted, revoked or has expired: ask for a new one')
  }
}
```

`InvitationNotFound` gives one answer for an unknown id and for a link that matches
nothing: whoever guesses links learns nothing from it.

Three events, in `modules/invitation/events/`:

```ts
// cooper/backend/contexts/auth/modules/invitation/events/invitation-created.ts
import { now, type DomainEvent } from 'newt/core'
import type { InvitationDTO } from '../invitation.schema'

/** Someone was invited to a workspace: its email leaves from a worker, after this. */
export class Invitation_Created implements DomainEvent<InvitationDTO> {
  static readonly eventName = 'invitation.created'
  readonly name = Invitation_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: InvitationDTO) {}
}
```

```ts
// cooper/backend/contexts/auth/modules/invitation/events/invitation-accepted.ts
import { now, type DomainEvent } from 'newt/core'
import type { InvitationDTO } from '../invitation.schema'

/** Someone accepted an invitation: they are a member of its workspace (`access.granted` says so too). */
export class Invitation_Accepted implements DomainEvent<InvitationDTO> {
  static readonly eventName = 'invitation.accepted'
  readonly name = Invitation_Accepted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: InvitationDTO) {}
}
```

```ts
// cooper/backend/contexts/auth/modules/invitation/events/invitation-revoked.ts
import { now, type DomainEvent } from 'newt/core'
import type { InvitationDTO } from '../invitation.schema'

/** An invitation no longer opens its workspace: its admin took it back, or the workspace is gone. */
export class Invitation_Revoked implements DomainEvent<InvitationDTO> {
  static readonly eventName = 'invitation.revoked'
  readonly name = Invitation_Revoked.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: InvitationDTO) {}
}
```

Their `occurredAt` is `now()`, like every event of auth since
[chapter 17](./17-auth). An event is made inside the use case that records it, so
`now()` there is auth's clock: with a clock of its own, auth's events tell its time.

### Its options, deps and repository

The module's options say which product it invites to, for how many days, which
mailer sends the email, and where the link points. Create
`modules/invitation/invitation-options.ts`:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation-options.ts
import type { Mailer } from '../../../../shared/mail/mailer'

export type Invitation_Options = {
  /** The product whose workspaces it invites to, whose access accepting gives: `cooper`. */
  productId: string
  /** How long an invitation waits to be accepted. */
  days: number
  /** Where its email leaves from. */
  mailer: Mailer
  /** The page of the invitation's link, where it is accepted: boards', which shows the workspace. */
  acceptUrl: (token: string) => string
}
```

The link opens boards, not auth: Bob sees the workspace he is invited to on the app
he will use. The module does not know boards' address; it is handed a function that
makes the link.

It uses three modules of auth: `tenant` (the workspace, and its admin), `access` (who
is a member already, and the access accepting gives) and `user` (who invited, and who
accepts). Create `modules/invitation/invitation.deps.ts`:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.deps.ts
import type { Access_Module } from '../access/access.module'
import type { Tenant_Module } from '../tenant/tenant.module'
import type { User_Module } from '../user/user.module'

export interface Invitation_Deps {
  tenant: Tenant_Module
  access: Access_Module
  user: User_Module
}
```

And `modules/invitation/invitation.repository.ts`, a table repository as any:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.repository.ts
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Invitation, type InvitationEntityDTO } from './invitation'

export type InvitationRow = InvitationEntityDTO & { version: number }

export class Invitation_Repository extends TableRepository<Invitation, InvitationRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: an invitation is found by its token before anyone is in its tenant; the use cases ask who is its admin.
    super(base, base.store.table<InvitationRow>('invitation'), { scope: 'none' })
  }

  protected toEntity(row: InvitationRow): Invitation {
    return Invitation.fromDTO(row)
  }
}
```

Its scope is `'none'`, as every repository of auth: an invitation is found by its
token, by someone who is not yet in its workspace. The use cases ask who is the
workspace's admin.

### Finding an account by its email

To know whether the invited email is a member already, the module looks for the
account of that email. Add `findByEmail` to `user.module.ts`, after `get`:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
  /** The account of an email, whatever its case, if there is one. */
  @UseCase()
  async findByEmail(email: string): Promise<UserDTO | null> {
    const parsed = Email.schema.safeParse(email.trim().toLowerCase())
    if (!parsed.success) return null
    return (await this.repo.first({ email: parsed.data }))?.toDTO() ?? null
  }
```

### The module

Create `modules/invitation/invitation.module.ts`:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.module.ts
import { currentActor, eventsOf, mapPage, Module, SecretToken, UseCase, type Page, type PageRequest } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { NotTenantAdmin } from '../tenant/errors/not-tenant-admin'
import { TenantNotFound } from '../tenant/errors/tenant-not-found'
import { AlreadyInvited } from './errors/already-invited'
import { InvitationForAnotherEmail } from './errors/invitation-for-another-email'
import { InvitationNotFound } from './errors/invitation-not-found'
import { InvitationNotOpen } from './errors/invitation-not-open'
import { Invitation_Accepted } from './events/invitation-accepted'
import { Invitation_Created } from './events/invitation-created'
import { Invitation_Revoked } from './events/invitation-revoked'
import { Invitation, InvitationCreateSchema, type InvitationDTO, type InvitationReviewDTO } from './invitation'
import type { Invitation_Deps } from './invitation.deps'
import type { Invitation_Options } from './invitation-options'
import { Invitation_Repository } from './invitation.repository'
import { registerInvitationWorkers } from './invitation.workers'

/**
 * Invitations to join a workspace: its admin invites by email, the email leaves from
 * a worker, and whoever signs in with that email accepts it and becomes a member.
 */
export class Invitation_Module extends Module {

  static initialize(base: AuthBase, deps: Invitation_Deps, options: Invitation_Options): Invitation_Module {
    const module = new Invitation_Module(base, new Invitation_Repository(base), deps, options)
    registerInvitationWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(
    base: AuthBase,
    private readonly repo: Invitation_Repository,
    private readonly deps: Invitation_Deps,
    private readonly options: Invitation_Options,
  ) {
    super('invitation', base.invocations)
    this.events = eventsOf(base.bus, { created: Invitation_Created, accepted: Invitation_Accepted, revoked: Invitation_Revoked })
  }

  /** The workspace's admin invites an email, which is not a member nor invited already. Its email leaves from a worker. */
  @UseCase()
  async create(tenantId: string, input: unknown): Promise<InvitationDTO> {
    const { email } = InvitationCreateSchema.parse(input)
    const invitation = Invitation.create({ tenantId, email, invitedBy: currentActor().userId, days: this.options.days })
    await this.assertAdmin(tenantId)
    const invited = await this.deps.user.findByEmail(invitation.email)
    const member = invited ? await this.deps.access.check(invited.id, this.options.productId, tenantId) : null
    if (member || await this.repo.count({ tenantId, email: invitation.email, status: 'pending' }) > 0) throw new AlreadyInvited(invitation.email)

    await this.repo.persist(invitation)
    return invitation.toDTO()
  }

  /** The invitations of a workspace still waiting, the newest first: for its admin. */
  @UseCase()
  async list(tenantId: string, page: PageRequest): Promise<Page<InvitationDTO>> {
    await this.assertAdmin(tenantId)
    const found = await this.repo.page({ tenantId, status: 'pending' }, page, { newestFirst: true })
    return mapPage(found, invitation => invitation.toDTO())
  }

  /** Its workspace's admin takes it back: its link opens nothing from then on. */
  @UseCase()
  async revoke(invitationId: string): Promise<void> {
    const invitation = await this.resolve(() => this.repo.find({ id: invitationId }), () => new InvitationNotFound())
    await this.assertAdmin(invitation.tenantId)
    if (invitation.status !== 'pending') throw new InvitationNotOpen()
    invitation.revoke()
    await this.repo.persist(invitation)
  }

  /** What the link's page shows before accepting it: to anyone who has the link. */
  @UseCase()
  async review(token: string): Promise<InvitationReviewDTO> {
    const invitation = await this.byToken(token)
    const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
    if (!tenant) throw new InvitationNotFound()
    const inviter = await this.deps.user.get(invitation.invitedBy)
    return { tenantId: tenant.id, tenantName: tenant.name, email: invitation.email, invitedByName: inviter.name, open: invitation.isOpen() }
  }

  /**
   * The signed-in person accepts it, if they have its email: they become a member of
   * the workspace. It writes to `access` without being a worker, on purpose: whoever
   * accepts enters at once. The access goes first, and is safe to give again: should
   * the invitation fail to be marked accepted, accepting again finishes it.
   */
  @UseCase({ writesTo: ['access'] })
  async accept(token: string): Promise<InvitationDTO> {
    const invitation = await this.byToken(token)
    // Its workspace deleted, it is not open any more, whatever its worker did yet.
    const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
    if (!invitation.isOpen() || !tenant) throw new InvitationNotOpen()
    const { userId } = currentActor()
    const me = await this.deps.user.get(userId)
    if (me.email !== invitation.email) throw new InvitationForAnotherEmail(invitation.email)

    await this.deps.access.admit({ userId, productId: this.options.productId, tenantId: invitation.tenantId, role: 'member' })
    invitation.accept(userId)
    await this.repo.persist(invitation)
    return invitation.toDTO()
  }

  /**
   * Sends its email, with a new token for its link: what its worker calls once it is
   * saved, since an email cannot be taken back. The token is made here, not when it
   * was created, so it is never kept in a job: the store only ever has its hash. Run
   * again, it sends a new link, and the one before stops working.
   */
  @UseCase()
  async send(invitationId: string): Promise<void> {
    const invitation = await this.repo.first({ id: invitationId })
    if (!invitation?.isOpen()) return
    const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
    if (!tenant) return
    const inviter = await this.deps.user.get(invitation.invitedBy)

    const token = invitation.issueToken()
    await this.repo.persist(invitation)
    await this.options.mailer.send({
      to: invitation.email,
      subject: `${inviter.name} invited you to ${tenant.name} on Cooper`,
      text: [
        `${inviter.name} invited you to join the workspace ${tenant.name} on Cooper.`,
        '',
        `Accept the invitation: ${this.options.acceptUrl(token)}`,
        '',
        `Sign in, or sign up, with ${invitation.email} to accept it. It expires on ${invitation.expiresAt.slice(0, 10)}.`,
      ].join('\n'),
    })
  }

  /** A deleted workspace's invitations open nothing: a step of its deletion, from a worker. Safe to run again. */
  @UseCase()
  async revokeForTenant(tenantId: string): Promise<void> {
    const pending = await this.repo.find({ tenantId, status: 'pending' })
    for (const invitation of pending) invitation.revoke()
    await this.repo.persist(...pending)
  }

  private async byToken(token: string): Promise<Invitation> {
    const parsed = SecretToken.schema.safeParse(token)
    const invitation = parsed.success ? await this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
    if (!invitation) throw new InvitationNotFound()
    return invitation
  }

  /** The signed-in person is the workspace's admin. Who is not even a member is told it does not exist. */
  private async assertAdmin(tenantId: string): Promise<void> {
    const access = await this.deps.access.check(currentActor().userId, this.options.productId, tenantId)
    if (!access) throw new TenantNotFound(tenantId)
    if (access.role !== 'admin') throw new NotTenantAdmin()
  }
}
```

Its use cases, one by one:

- **`create`**: the admin invites an email. It parses the input, builds the entity
  (which fixes the email's case), checks the admin, and refuses an email that is a
  member already or has a pending invitation. It sends nothing: the email leaves from
  a worker, once the invitation is saved.
- **`list`** and **`revoke`**: the admin's. A revoked invitation keeps its row with
  its status, and its link opens nothing.
- **`review`**: what the link's page shows. Anyone with the link may ask; the link is
  the secret.
- **`accept`**: the signed-in person accepts, if they signed in with the invited
  email. It checks that the workspace is still there: a workspace deleted a moment
  ago has its invitations revoked by a worker, and until that worker runs the
  invitation still says pending. Then it gives the access with `access.admit`
  ([chapter 18](./18-tenants-and-access)) and marks the invitation accepted. Writing
  to `access` outside a worker breaks the write rule, so it says so with
  `writesTo: ['access']`, for the same reason as `tenant.create`: the person waits for
  the answer, and enters at once. The access goes first because `admit` is safe to
  run again: if marking the invitation fails, accepting once more finishes it.
- **`send`**: what the worker calls. It makes the token, saves its hash, and sends
  the email with the link.
- **`revokeForTenant`**: a step of a workspace's deletion, from a worker.

### Why the token is made when the email leaves

`create` could make the token, keep its hash, and pass the token to the worker. But
the worker's job keeps its payload in the store until it runs: the token would sit in
the outbox, in clear, next to its hash. Anyone reading the database could use it.

So the token is made in `send`, which the worker calls. It lives only in memory, and
then in the email. The store has only its hash, never the token itself.

The price: if the job runs twice (the email left, then the process stopped before the
job was marked done), Bob gets two emails, and only the second link works. That is
better than a link that anyone with access to the database can use. A test below shows
it.

### Its workers

Create `modules/invitation/invitation.workers.ts`:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.workers.ts
import type { Invitation_Deps } from './invitation.deps'
import type { Invitation_Module } from './invitation.module'

/**
 * An invitation's email leaves once it is saved, from a job: an email cannot be taken
 * back, so it never leaves for an invitation that rolled back. And a deleted
 * workspace's invitations stop opening it.
 */
export function registerInvitationWorkers(invitations: Invitation_Module, deps: Invitation_Deps): void {
  invitations.events.created.subscribe(invitation => invitations.send(invitation.id), {
    strategy: 'handler',
    queue: 'invitation.send.on.invitation.created',
  })
  deps.tenant.events.deleted.subscribe(tenant => invitations.revokeForTenant(tenant.id), {
    strategy: 'handler',
    queue: 'invitation.revokeForTenant.on.tenant.deleted',
  })
}
```

The email leaves on `invitation.created`, from a `handler`: a job written with the
invitation, in the same transaction ([chapter 12](./12-failures)). An invitation that
rolled back has no job, so no email leaves for it.

A deleted workspace's invitations are revoked on `tenant.deleted`, one more step of
the saga that event starts ([chapter 14](./14-sagas)). `revokeForTenant` finds the
pending ones and revokes them; the second time, there are none. Say so in the
event's comment. Replace the comment in `tenant/events/tenant-deleted.ts`:

```ts
// cooper/backend/contexts/auth/modules/tenant/events/tenant-deleted.ts
/**
 * A workspace was deleted: the start of a saga. auth revokes its invitations, and
 * takes every access to it away once more (`delete` already did, in the request);
 * boards deletes its boards. Each from a worker.
 */
```

and the line of `tenant.delete`'s comment, in `tenant.module.ts`:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
   * Only its admin deletes it. The rest follows from `tenant.deleted`, each part from
   * a worker: its invitations here, its boards in boards, its accesses once more.
```

### Wiring it

`initializeModules` takes `Auth_ModuleDeps`, and initializes the invitation module
after the three it uses. Replace the imports and the function in
`initialize-modules.ts`, and add the type:

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Auth_Config } from './auth-config'
import type { AuthBase } from './auth-base'
import { Access_Module } from './modules/access/access.module'
import { Invitation_Module } from './modules/invitation/invitation.module'
import { Product_Module } from './modules/product/product.module'
import { PRODUCTS, WORKSPACES_PRODUCT, type ProductDTO } from './modules/product/product.schema'
import { Session_Module } from './modules/session/session.module'
import { Tenant_Module } from './modules/tenant/tenant.module'
import { User_Module } from './modules/user/user.module'

/** What `auth`'s modules are given besides its base. */
export type Auth_ModuleDeps = {
  mailer: Mailer
}
// …
/** Every module of `auth`, each one after the modules it uses. */
export function initializeModules(base: AuthBase, config: Auth_Config, deps: Auth_ModuleDeps) {
  const product = Product_Module.initialize(base, { products: declaredProducts(config) })
  const user = User_Module.initialize(base)
  const session = Session_Module.initialize(base, { user, product }, { days: config.sessionDays })
  const access = Access_Module.initialize(base, { product })
  const tenant = Tenant_Module.initialize(base, { access }, { productId: WORKSPACES_PRODUCT })
  const invitation = Invitation_Module.initialize(base, { tenant, access, user }, {
    productId: WORKSPACES_PRODUCT,
    days: config.invitationDays,
    mailer: deps.mailer,
    // The link opens boards, which shows the workspace and accepts it through its own origin.
    acceptUrl: token => `${config.boardsPublicUrl}/invitations/${token}`,
  })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { product, user, session, access, tenant, invitation, outbox }
}
```

`openContexts` hands auth the mailer it already made for boards, and a clock when its
caller gives one. Replace the top of `open-contexts.ts`, down to the line that opens
auth:

```ts
// cooper/backend/open-contexts.ts
import type { Clock } from 'newt/core'
import type { Config } from './config'
import { Auth_Context } from './contexts/auth/auth.context'
import { Boards_Context } from './contexts/boards/boards.context'
import { MemoryCardSearch } from './contexts/boards/search/memory-card-search'
import { FakeAuth } from './contexts/boards/testing/fake-auth'
import { ConsoleMailer } from './shared/mail/console-mailer'
import type { Mailer } from './shared/mail/mailer'

/** What the contexts are given from outside: the console mailer unless another is, and the real time unless a test gives a clock. */
export type OpenContextsOptions = {
  mailer?: Mailer
  clock?: Clock
}

/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`. The server opens them.
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  const { clock } = options
  const auth = await Auth_Context.open(config.auth, { mailer }, clock)
```

boards still asks the fake auth. Nothing invites over HTTP yet: boards' routes do, in
[chapter 20](./20-wiring-contexts), when boards is wired to the real auth.

## Schedules: what the clock tells

Now the expired sessions. Removing them is a use case like any other. Add
`purgeExpired` to `session.repository.ts`, after `toEntity`:

```ts
// cooper/backend/contexts/auth/modules/session/session.repository.ts
  /** Removes for good the sessions expired by `at`, closed by nobody: how many it removed. */
  purgeExpired(at: Date): Promise<number> {
    return this.purge({ expiresAt: { lte: at.toISOString() } })
  }
```

`purge` removes rows for good, with no event ([chapter 14](./14-sagas)). A session
tells nothing when it goes, so that is what it wants.

What is new is who calls it. Nobody asks for it; it is due at a time. newt says that
with a **schedule**: an event the context tells each time a cron expression says it is
due.

```ts
this.nightly = base.schedules.define('session.nightly', '0 3 * * *')
```

`base.schedules.define(name, cron)` gives an emitter, like the ones in a module's
`events`. The name is an event's name, `<module>.<name>`. The cron expression has
five fields (minute, hour, day of the month, month, day of the week), read in UTC:
`0 3 * * *` is three in the morning, every day. Its payload is `{ dueAt }`, the minute
it was due.

Modules **subscribe** to it as to any event, with the same `subscribe` and the same
strategies. A `handler` subscription is a job of the outbox, written in the same
transaction as the tick, and tried again until it succeeds ([chapter
12](./12-failures)). A schedule is not something new to learn: it is one more event
source, and the clock is what tells it.

What newt guarantees about it:

- **Each tick is told once, however many processes run the context.** Each process
  looks at its schedules as they come due. The first to record the tick in the
  store's `schedule_tick` table tells it, writing the jobs of its handlers in the same
  transaction. The others find it recorded and tell nothing.
- **Ticks missed while no process ran are told as one.** A server stopped for three
  nights tells one tick when it starts, the last one due, not three. A worker that
  removes what is expired by now does the same work either way.
- **A schedule seen for the first time tells nothing of before.** It records where it
  stands and waits for its next tick. A new schedule does not fire for every night
  since the epoch.
- **Schedules start and stop with the context's jobs.** `start()` starts them; a test
  that never starts the context's worker can still fire what is due with
  **`base.schedules.tick()`**, after moving its clock.

What is left to you: make the handler safe to run again, as any handler, and say in
the schedule's name what it is for.

Add the schedule to the session module. The module defines it in its constructor and
offers it as `nightly`, as it would offer its events. Change the import from
`newt/core` to take `now`, import the workers, register them in `initialize`, and add
the field and its definition:

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
import { currentActor, Module, now, SecretToken, UseCase, type Actor } from 'newt/core'
// …
import { registerSessionRoutes } from './session.routes'
import { registerSessionWorkers } from './session.workers'
// …
  static initialize(base: AuthBase, deps: Session_Deps, options: Session_Options): Session_Module {
    const module = new Session_Module(base, new Session_Repository(base), deps, options)
    base.http.authenticateWith(request => module.authenticate(request.cookies.get(SessionCookie) ?? undefined))
    registerSessionRoutes(base, module)
    registerSessionWorkers(module)
    return module
  }

  /** At three every night (UTC): a schedule, told as an event its workers subscribe to. */
  readonly nightly

  private constructor(
    base: AuthBase,
    private readonly repo: Session_Repository,
    private readonly deps: Session_Deps,
    readonly options: Session_Options,
  ) {
    super('session', base.invocations)
    this.nightly = base.schedules.define('session.nightly', '0 3 * * *')
  }
```

Then the use case the worker calls, after `authenticate`:

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
  /**
   * Removes the sessions that expired: nobody signed out of them, and an expired one
   * is closed only when its browser comes back. What the nightly worker calls; the
   * second time, there are none.
   */
  @UseCase()
  async purgeExpired(): Promise<number> {
    return this.repo.purgeExpired(now())
  }
```

It asks `now()`, not the tick's `dueAt`: a tick told late, after a night the server
was down, still removes everything expired by the time it runs.

And the subscription. Create `modules/session/session.workers.ts`:

```ts
// cooper/backend/contexts/auth/modules/session/session.workers.ts
import type { Session_Module } from './session.module'

/** Every night, the sessions past their days go: nobody signs in with them again, and their rows would only pile up. */
export function registerSessionWorkers(sessions: Session_Module): void {
  sessions.nightly.subscribe(() => sessions.purgeExpired(), {
    strategy: 'handler',
    queue: 'session.purgeExpired.on.session.nightly',
  })
}
```

The queue follows the name rule ([chapter 11](./11-reacting)): the use case that
reacts, `.on.`, and the event, which here is the schedule's name.

## Tests

auth's tests give auth a clock of their own and a mailer that keeps what it sends, the
`RecordingMailer` of [chapter 12](./12-failures). At the top of `auth.test.ts`, import
`Mail` and `RecordingMailer`, add the two variables, and open auth with both:

```ts
// cooper/backend/contexts/auth/auth.test.ts
import type { Mail } from '../../shared/mail/mailer'
import { RecordingMailer } from '../../shared/mail/recording-mailer'
import { Auth_Context } from './auth.context'
import type { UserDTO } from './modules/user/user.schema'

let auth: Auth_Context
let mails: Mail[]
/** The time by auth's clock: a test moves it instead of waiting. */
let time: number

beforeEach(async () => {
  const mailer = new RecordingMailer()
  mails = mailer.mails
  // Set before auth opens: its schedules' first look, as it starts, is at noon of this day.
  time = Date.parse('2027-03-15T12:00:00Z')
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port: 0 }, { mailer }, { now: () => new Date(time) })
  auth.start()
})
```

The clock is set before auth opens, at noon of a fixed day. `auth.start()` starts its
schedules, and their first look is as they start: at that time, then. A test that
counts nights knows where the schedule stands from the start.

Two helpers, after `page`: a day in milliseconds, and the token in the link of the
last email:

```ts
// cooper/backend/contexts/auth/auth.test.ts
const page = { size: 20 }
const DAY_MS = 24 * 60 * 60_000
/** The token in the link of the last email sent. */
const linkToken = () => mails.at(-1)!.text.match(/invitations\/([A-Za-z0-9_-]{43})/)![1]!
```

In `accounts`, after the first test, one that the events follow the clock: a
`fire-and-forget` subscriber keeps the `occurredAt` of `user.signedUp`, and it is the
time the test set, not the real one:

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('tells someone signed up at the time by auth\'s clock', async () => {
    const told: string[] = []
    modules().user.events.signedUp.subscribe((_, event) => { told.push(event.occurredAt) }, { strategy: 'fire-and-forget' })
    time = Date.parse('2027-04-01T08:30:00Z')

    await signUp('Ana')

    expect(told).toEqual(['2027-04-01T08:30:00.000Z'])
  })
```

After the test that opens a session at sign-up: a session that ends
by the clock, and the nightly purge:

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('ends a session once its days pass by auth\'s clock', async () => {
    const { token } = await modules().session.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })

    time += (config.auth.sessionDays - 1) * DAY_MS
    expect(await modules().session.authenticate(token)).not.toBeNull()
    time += DAY_MS
    expect(await modules().session.authenticate(token)).toBeNull()
  })

  test('removes the expired sessions every night at three, by auth\'s clock', async () => {
    const sessions = () => auth.base.store.table('session').count({})
    // Its own loop stopped, once its first look, as auth started, is done: the test ticks
    // by hand. That first look told nothing of before: the next tick is tonight's.
    await auth.base.schedules.stop()
    await modules().session.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })
    time += config.auth.sessionDays * DAY_MS
    await modules().session.signIn({ email: 'ana@cooper.test', password: 'a long password' })
    expect(await sessions()).toBe(2)

    await auth.base.schedules.tick()
    await settled()

    expect(await sessions()).toBe(1)
  })
```

The first test moves the clock a day short of the session's days, then one more day.
No waiting.

The second starts at noon on the fixed day of `beforeEach`, where the schedule's first
look already was. It stops auth's own schedule loop with `base.schedules.stop()`: the
loop wakes at least once a minute and would see the clock moved, and a tick it told
while the test ticks too would race with the test's. From then on, only the test ticks.
Then Ana signs up (a session that expires 30 days later, at noon), the clock moves
those 30 days, and she signs in again (a second session). Thirty nights at three went by with no tick told; the next `tick()` tells
one, the last. Its job runs on `settled()`, and of the two sessions the expired one
is gone.

The test of a workspace's deletion now also checks its invitations. Rename it, and
invite someone before deleting:

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('takes every access and invitation away once deleted, from its workers', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await as(ana, () => modules().invitation.create(acme.id, { email: 'cai@cooper.test' }))
```

And at the end of the file, the invitations:

```ts
// cooper/backend/contexts/auth/auth.test.ts
describe('invitations', () => {
  test('are sent by a worker once saved, and accepted by whoever signs in with their email', async () => {
    const [ana, bob, eve] = [await signUp('Ana'), await signUp('Bob'), await signUp('Eve')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))

    const invitation = await as(ana, () => modules().invitation.create(acme.id, { email: 'BOB@cooper.test' }))
    expect(invitation).toMatchObject({ email: 'bob@cooper.test', status: 'pending' })
    expect(mails).toEqual([])
    await settled()
    expect(mails.map(mail => [mail.to, mail.subject])).toEqual([['bob@cooper.test', 'Ana invited you to Acme on Cooper']])

    const token = linkToken()
    expect(await modules().invitation.review(token)).toMatchObject({ tenantName: 'Acme', invitedByName: 'Ana', open: true })
    await expect(as(eve, () => modules().invitation.accept(token))).rejects.toMatchObject({ code: 'invitation.another_email' })
    expect(await as(bob, () => modules().invitation.accept(token))).toMatchObject({ status: 'accepted', acceptedBy: bob.id })
    expect(await modules().access.check(bob.id, 'cooper', acme.id)).toMatchObject({ role: 'member' })
    await expect(as(bob, () => modules().invitation.accept(token))).rejects.toMatchObject({ code: 'invitation.not_open' })
  })

  test('cannot be accepted once their days pass by auth\'s clock', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().invitation.create(acme.id, { email: 'bob@cooper.test' }))
    await settled()
    const token = linkToken()

    time += config.auth.invitationDays * DAY_MS
    expect(await modules().invitation.review(token)).toMatchObject({ open: false })
    await expect(as(bob, () => modules().invitation.accept(token))).rejects.toMatchObject({ code: 'invitation.not_open' })
  })

  test('cannot be accepted once their workspace is deleted, before its workers run', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().invitation.create(acme.id, { email: 'bob@cooper.test' }))
    await settled()
    const token = linkToken()
    await auth.base.jobs.stop()

    await as(ana, () => modules().tenant.delete(acme.id))
    await expect(as(bob, () => modules().invitation.accept(token))).rejects.toMatchObject({ code: 'invitation.not_open' })
    await settled()
    expect(await modules().access.check(bob.id, 'cooper', acme.id)).toBeNull()
  })

  test('are made, listed and revoked by the admin only, once per email', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))

    await expect(as(bob, () => modules().invitation.create(acme.id, { email: 'cai@cooper.test' }))).rejects.toMatchObject({ code: 'tenant.not_admin' })
    await expect(as(ana, () => modules().invitation.create(acme.id, { email: 'bob@cooper.test' }))).rejects.toMatchObject({ code: 'invitation.already_invited' })
    const invitation = await as(ana, () => modules().invitation.create(acme.id, { email: 'cai@cooper.test' }))
    await expect(as(ana, () => modules().invitation.create(acme.id, { email: 'cai@cooper.test' }))).rejects.toMatchObject({ code: 'invitation.already_invited' })
    expect(await as(ana, () => modules().invitation.list(acme.id, page))).toMatchObject({ items: [{ email: 'cai@cooper.test' }], total: 1 })

    await settled()
    const token = linkToken()
    await as(ana, () => modules().invitation.revoke(invitation.id))
    expect((await as(ana, () => modules().invitation.list(acme.id, page))).total).toBe(0)
    const cai = await signUp('Cai')
    await expect(as(cai, () => modules().invitation.accept(token))).rejects.toMatchObject({ code: 'invitation.not_open' })
  })

  test('send a new link when their email is sent again, and the one before stops working', async () => {
    const ana = await signUp('Ana')
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    const invitation = await as(ana, () => modules().invitation.create(acme.id, { email: 'bob@cooper.test' }))
    await settled()
    const first = linkToken()

    // As its job run again after the email left: a new link, which is the only one that works.
    await modules().invitation.send(invitation.id)
    const second = linkToken()
    expect(second).not.toBe(first)
    await expect(modules().invitation.review(first)).rejects.toMatchObject({ code: 'invitation.not_found' })
    expect(await modules().invitation.review(second)).toMatchObject({ open: true })
  })
})
```

- The first test follows an invitation from start to end. No email has left when
  `create` answers; it leaves on `settled()`, from the worker. Eve has the link but
  another email; Bob accepts, and is a member. A second accept finds it closed.
- The second moves the clock by the invitation's days. Nothing waits a week.
- The third stops auth's worker, so `tenant.deleted`'s jobs do not run, and deletes
  the workspace. The invitation still says pending, and `accept` refuses it anyway:
  it checks the workspace. When the jobs run, Bob has no access.
- The fourth checks the admin's part: only she invites, once per email, and a member
  is not invited again.
- The fifth calls `send` a second time, as a job run twice would: a second link, and
  the first one is not found.

## Check it

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 98 pass
 0 fail
```

The tests of this chapter on their own:

```sh
bun test cooper/backend/contexts/auth -t 'clock|invitations'
```

```text
 8 pass
 14 filtered out
 0 fail
 26 expect() calls
Ran 8 tests across 1 file.
```

Then the schedule, by hand. Start the backend (`bun cooper/backend/index.ts`), stop
it with Ctrl+C after it says it is listening, and look at auth's database:

```sh
sqlite3 data/cooper-auth.db 'select * from schedule_tick'
```

```text
session.nightly|2026-10-26T03:00:00.000Z|1
```

The schedule was seen for the first time: it recorded the last tick due (three this
morning, UTC; your date differs) and told nothing. The next one is tonight's.

## What to remember

- Time is a dependency. A context's `Base` takes a `clock`; your code asks `now()`,
  never `new Date()`. A test gives `{ now: () => new Date(time) }` and moves `time`.
- What is due at a time is a schedule: `base.schedules.define(name, cron)`, in UTC,
  offered by its module like its events, and subscribed to with the same
  `subscribe`. A `handler` makes each tick a job, tried until it succeeds.
- Each tick is told once, by whichever process records it first; missed ticks are
  told as one; a new schedule waits for its next tick. A test calls
  `base.schedules.tick()` after moving its clock, once it has stopped the context's
  own loop (`base.schedules.stop()`).
- A secret is made where it leaves, never kept in a job: the store holds only its
  hash. Sent twice, the second link is the one that works.
- A use case that checks something a saga will change, as `accept` checks the
  workspace, does not wait for the saga's workers.

Next: [Wiring contexts together](./20-wiring-contexts).
