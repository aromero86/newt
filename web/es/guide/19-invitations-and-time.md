# Invitaciones y tiempo

Ana creó Acme en el [capítulo 18](./18-tenants-and-access). Ahora quiere a Bob dentro.
Conoce su email, no su cuenta; puede que ni la tenga todavía. Así que invita al email:
cooper envía a Bob un enlace, y quien inicie sesión con ese email y abra el enlace pasa a
ser miembro de Acme.

Una invitación no debe esperar para siempre. Siete días después de enviarla, el enlace no
abre nada. Las sesiones ya funcionan así: cada una termina pasados sus días
([capítulo 17](./17-auth)). Las dos leen la hora, y hasta ahora leían la real. Un test que
quiera ver caducar una invitación tendría que esperar una semana.

El tiempo trae otra cosa. Una sesión caducada solo se cierra cuando su navegador vuelve, y
muchos no vuelven nunca. Sus filas se acumulan. Algo debería quitarlas cada noche, sin que
nadie lo pida.

Este capítulo hace del tiempo algo que se le da a auth, como su store: un **reloj**. Un
test da el suyo y lo mueve. Después añade las invitaciones, que caducan según ese reloj, y
una **programación** (`schedule`), un evento que el reloj cuenta a las tres de cada
noche, cuyo worker quita las sesiones caducadas.

## El tiempo es una dependencia: el reloj

El `Base` de newt toma un `clock` entre sus opciones. Un `Clock` es un solo método:

```ts
type Clock = { now(): Date }
```

Todo lo que hay en el contexto que lee la hora la lee de ahí:

- el `createdAt` y el `updatedAt` que sus repositorios escriben en cada entidad;
- cuándo toca cada uno de sus jobs, y cuánto esperan entre intentos;
- cuándo tocan sus programaciones (más abajo);
- **`now()`**, de `newt/core`, en sus casos de uso y sus handlers.

`now()` es lo que tu código llama en lugar de `new Date()` o `Date.now()`. Dentro de un
caso de uso da la hora según el reloj del contexto que lo ejecuta; fuera de cualquiera,
la hora real. Sin `clock`, un `Base` usa la hora real, así que en producción nada cambia.
Un test da `{ now: () => new Date(time) }` y mueve `time` en lugar de esperar.

`Auth_Context.open` toma un reloj y se lo pasa a su base. También toma lo que sus módulos
reciben de fuera, `Auth_ModuleDeps`: las invitaciones envían un email, así que auth
necesita ahora un mailer, como boards en el [capítulo 12](./12-failures). Reemplaza
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

La sesión es la primera en leer la hora. Reemplaza el import y los dos sitios de
`session.ts` que leen la hora real:

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

`Session.open` e `isExpired` se ejecutan dentro de los casos de uso del módulo de sesión,
así que `now()` es el reloj de auth ahí. La entidad no sabe de dónde viene la hora, y no
necesita un parámetro para ella.

## Invitaciones

Una invitación es una fila de auth: quién es invitado (un email), a qué workspace, por
quién, su estado y hasta cuándo espera. Tiene un módulo propio, `invitation`, con los
mismos archivos que cualquier módulo.

### Cuánto espera

Añade el ajuste a `config.ts`, en `auth`, después de `sessionDays`:

```ts
// cooper/backend/config.ts
    sessionDays,
    /** `COOPER_INVITATION_DAYS`: how long an invitation to a workspace waits to be accepted. */
    invitationDays: Number(env.COOPER_INVITATION_DAYS ?? 7),
  },
```

### Su tabla

Crea la migración `migrations/sqlite/00006_invitation_up.sql`:

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

y su `00006_invitation_down.sql`:

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00006_invitation_down.sql
DROP TABLE invitation;
```

`token_hash` puede ser null, y es único cuando no lo es. El token del enlace no se hace al
crear la invitación, sino cuando sale su email: más abajo verás por qué. El índice sirve a
las dos preguntas más frecuentes: las invitaciones pendientes de un workspace, y si un
email ya tiene una.

### Su esquema

Crea `modules/invitation/invitation.schema.ts`:

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

- `InvitationSchema` es lo que se le muestra a cualquiera de una invitación. El email es un
  `Email` ([capítulo 17](./17-auth)): en minúsculas, así que `BOB@cooper.test` y
  `bob@cooper.test` son una sola invitación.
- `InvitationCreateSchema` es lo que envía el admin: un email, con los mensajes que muestra
  un formulario.
- `InvitationReviewSchema` es lo que muestra la página del enlace antes de que nadie
  acepte: qué workspace, para qué email, quién invitó y si todavía se puede aceptar.

### La entidad

Crea `modules/invitation/invitation.ts`:

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

- Guarda más de lo que muestra, como hace el usuario con el hash de su contraseña: el
  esquema de la entidad extiende `InvitationSchema` con `tokenHash`, y `toDTO()` da solo
  los campos de `InvitationSchema`.
- `create` fija `expiresAt` a partir de `now()`, unos días por delante. `isOpen` compara
  con `now()`. Los dos se ejecutan dentro de los casos de uso del módulo, así que los dos
  van por el reloj de auth: un test que lo mueva una semana adelante ve la invitación
  cerrada.
- `issueToken` hace un `SecretToken` nuevo y guarda solo su hash. Si se llama otra vez,
  reemplaza el hash, y el enlace anterior deja de funcionar.
- `create`, `accept` y `revoke` cuentan cada uno su evento.

### Sus errores y eventos

Cuatro errores, cada uno con su código. Créalos en `modules/invitation/errors/`:

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

`InvitationNotFound` da una sola respuesta para un id desconocido y para un enlace que no
coincide con nada: quien adivina enlaces no aprende nada de ella.

Tres eventos, en `modules/invitation/events/`:

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

Su `occurredAt` es `now()`, como en todo evento de auth desde el
[capítulo 17](./17-auth). Un evento se crea dentro del caso de uso que lo registra, así que
`now()` ahí es el reloj de auth: con un reloj propio, los eventos de auth dicen su hora.

### Sus opciones, deps y repositorio

Las opciones del módulo dicen a qué producto invita, durante cuántos días, qué mailer envía
el email y adónde apunta el enlace. Crea `modules/invitation/invitation-options.ts`:

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

El enlace abre boards, no auth: Bob ve el workspace al que lo invitan en la app que va a
usar. El módulo no conoce la dirección de boards; recibe una función que hace el enlace.

Usa tres módulos de auth: `tenant` (el workspace y su admin), `access` (quién es ya miembro
y el acceso que da aceptar) y `user` (quién invitó y quién acepta). Crea
`modules/invitation/invitation.deps.ts`:

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

Y `modules/invitation/invitation.repository.ts`, un repositorio de tabla como cualquier
otro:

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

Su ámbito es `'none'`, como el de todo repositorio de auth: una invitación se encuentra
por su token, y quien la busca aún no está en su espacio de trabajo. Los casos de uso
preguntan quién es el admin del espacio de trabajo.

### Buscar una cuenta por su email

Para saber si el email invitado ya es miembro, el módulo busca la cuenta de ese email.
Añade `findByEmail` a `user.module.ts`, después de `get`:

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

### El módulo

Crea `modules/invitation/invitation.module.ts`:

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
    super('invitation', base.invocations, deps)
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

Sus casos de uso, uno por uno:

- **`create`**: el admin invita a un email. Parsea la entrada, construye la entidad (que
  fija las mayúsculas y minúsculas del email), comprueba al admin y rechaza un email que ya
  es miembro o que tiene una invitación pendiente. No envía nada: el email sale de un
  worker, una vez guardada la invitación.
- **`list`** y **`revoke`**: del admin. Una invitación revocada conserva su fila con su
  estado, y su enlace no abre nada.
- **`review`**: lo que muestra la página del enlace. Puede preguntarlo cualquiera que tenga
  el enlace; el enlace es el secreto.
- **`accept`**: la persona con sesión acepta, si inició sesión con el email invitado.
  Comprueba que el workspace sigue ahí: un workspace borrado hace un momento tiene sus
  invitaciones revocadas por un worker, y hasta que ese worker se ejecute la invitación
  todavía dice pendiente. Después da el acceso con `access.admit`
  ([capítulo 18](./18-tenants-and-access)) y marca la invitación como aceptada. Escribir
  en `access` fuera de un worker rompe la regla de escritura, así que lo dice con
  `writesTo: ['access']`, por la misma razón que `tenant.create`: la persona espera la
  respuesta, y entra al instante. El acceso va primero porque `admit` se puede ejecutar
  otra vez sin riesgo: si falla marcar la invitación, aceptar una vez más la termina.
- **`send`**: lo que llama el worker. Hace el token, guarda su hash y envía el email con el
  enlace.
- **`revokeForTenant`**: un paso del borrado de un workspace, desde un worker.

### Por qué el token se hace cuando sale el email

`create` podría hacer el token, guardar su hash y pasar el token al worker. Pero el job del
worker guarda su payload en el store hasta que se ejecuta: el token estaría en el outbox, en
claro, junto a su hash. Cualquiera que leyera la base de datos podría usarlo.

Así que el token se hace en `send`, que es lo que llama el worker. Vive solo en memoria, y
luego en el email. El store tiene solo su hash, nunca el token.

El precio: si el job se ejecuta dos veces (el email salió y el proceso se detuvo antes de
marcar el job como hecho), Bob recibe dos emails, y solo funciona el segundo enlace. Es
mejor que un enlace que pueda usar cualquiera con acceso a la base de datos. Un test más
abajo lo muestra.

### Sus workers

Crea `modules/invitation/invitation.workers.ts`:

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

El email sale con `invitation.created`, desde un `handler`: un job escrito junto con la
invitación, en la misma transacción ([capítulo 12](./12-failures)). Una invitación que se
deshizo no tiene job, así que no sale ningún email por ella.

Las invitaciones de un workspace borrado se revocan con `tenant.deleted`, un paso más de la
saga que inicia ese evento ([capítulo 14](./14-sagas)). `revokeForTenant` busca las
pendientes y las revoca; la segunda vez no hay ninguna. Dilo en el comentario del evento.
Reemplaza el comentario en `tenant/events/tenant-deleted.ts`:

```ts
// cooper/backend/contexts/auth/modules/tenant/events/tenant-deleted.ts
/**
 * A workspace was deleted: the start of a saga. auth revokes its invitations, and
 * takes every access to it away once more (`delete` already did, in the request);
 * boards deletes its boards. Each from a worker.
 */
```

y la línea del comentario de `tenant.delete`, en `tenant.module.ts`:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
   * Only its admin deletes it. The rest follows from `tenant.deleted`, each part from
   * a worker: its invitations here, its boards in boards, its accesses once more.
```

### Conectarlo

`initializeModules` toma `Auth_ModuleDeps`, e inicializa el módulo de invitaciones después
de los tres que usa. Reemplaza los imports y la función en `initialize-modules.ts`, y
añade el tipo:

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

`openContexts` da a auth el mailer que ya hizo para boards, y un reloj cuando su llamante
lo da. Reemplaza el principio de `open-contexts.ts`, hasta la línea que abre auth:

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

boards sigue preguntando al auth falso. Nada invita todavía por HTTP: las rutas de boards
lo hacen en el [capítulo 20](./20-wiring-contexts), cuando boards se conecta al auth real.

## Programaciones: lo que cuenta el reloj

Ahora las sesiones caducadas. Quitarlas es un caso de uso como cualquier otro. Añade
`purgeExpired` a `session.repository.ts`, después de `toEntity`:

```ts
// cooper/backend/contexts/auth/modules/session/session.repository.ts
  /** Removes for good the sessions expired by `at`, closed by nobody: how many it removed. */
  purgeExpired(at: Date): Promise<number> {
    return this.purge({ expiresAt: { lte: at.toISOString() } })
  }
```

`purge` quita filas para siempre, sin evento ([capítulo 14](./14-sagas)). Una sesión no
cuenta nada cuando se va, así que eso es lo que quiere.

Lo nuevo es quién lo llama. Nadie lo pide; toca a una hora. newt lo dice con una
**programación** (`schedule`): un evento que el contexto cuenta cada vez que una expresión
cron dice que toca.

```ts
this.nightly = base.schedules.define('session.nightly', '0 3 * * *')
```

`base.schedules.define(name, cron)` da un emisor, como los de los `events` de un módulo. El
nombre es el nombre de un evento, `<módulo>.<nombre>`. La expresión cron tiene cinco campos
(minuto, hora, día del mes, mes, día de la semana), leídos en UTC: `0 3 * * *` son las tres
de la madrugada, todos los días. Su payload es `{ dueAt }`, el minuto en que tocaba.

Los módulos se **suscriben** a ella como a cualquier evento, con el mismo `subscribe` y las
mismas estrategias. Una suscripción `handler` es un job del outbox, escrito en la misma
transacción que el tic, y se intenta de nuevo hasta que lo consigue ([capítulo
12](./12-failures)). Una programación no es nada nuevo que aprender: es una fuente de
eventos más, y el reloj es quien la cuenta.

Lo que newt garantiza sobre ella:

- **Cada tic se cuenta una vez, se ejecuten los procesos que se ejecuten del contexto.**
  Cada proceso mira sus programaciones según les toca. El primero que registra el tic en la
  tabla `schedule_tick` del store lo cuenta, escribiendo los jobs de sus handlers en la
  misma transacción. Los demás lo encuentran registrado y no cuentan nada.
- **Los tics perdidos mientras ningún proceso corría se cuentan como uno.** Un servidor
  parado tres noches cuenta un tic cuando arranca, el último que tocaba, no tres. Un
  worker que quita lo caducado a estas alturas hace el mismo trabajo de las dos maneras.
- **Una programación vista por primera vez no cuenta nada de antes.** Registra dónde está y
  espera a su siguiente tic. Una programación nueva no se dispara por cada noche desde la
  época Unix.
- **Las programaciones arrancan y paran con los jobs del contexto.** `start()` las arranca;
  un test que nunca arranca el worker del contexto puede disparar lo que toca con
  **`base.schedules.tick()`**, después de mover su reloj.

Lo que queda para ti: hacer que el handler se pueda ejecutar otra vez sin riesgo, como
cualquier handler, y decir en el nombre de la programación para qué sirve.

Añade la programación al módulo de sesión. El módulo la define en su constructor y la
ofrece como `nightly`, como ofrecería sus eventos. Cambia el import de `newt/core` para
tomar `now`, importa los workers, regístralos en `initialize`, y añade el campo y su
definición:

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
    super('session', base.invocations, deps)
    this.nightly = base.schedules.define('session.nightly', '0 3 * * *')
  }
```

Después el caso de uso que llama el worker, después de `authenticate`:

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

Pregunta a `now()`, no al `dueAt` del tic: un tic contado tarde, tras una noche con el
servidor caído, quita igualmente todo lo caducado en el momento en que se ejecuta.

Y la suscripción. Crea `modules/session/session.workers.ts`:

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

La cola sigue la regla de nombres ([capítulo 11](./11-reacting)): el caso de uso que
reacciona, `.on.`, y el evento, que aquí es el nombre de la programación.

## Tests

Los tests de auth dan a auth un reloj propio y un mailer que guarda lo que envía, el
`RecordingMailer` del [capítulo 12](./12-failures). Al principio de `auth.test.ts`, importa
`Mail` y `RecordingMailer`, añade las dos variables y abre auth con los dos:

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

El reloj se fija antes de abrir auth, a mediodía de un día fijo. `auth.start()` arranca
sus programaciones, y su primera mirada es al arrancar: a esa hora, por tanto. Un test que
cuenta noches sabe desde el principio dónde está la programación.

Dos ayudantes, después de `page`: un día en milisegundos, y el token del enlace del último
email:

```ts
// cooper/backend/contexts/auth/auth.test.ts
const page = { size: 20 }
const DAY_MS = 24 * 60 * 60_000
/** The token in the link of the last email sent. */
const linkToken = () => mails.at(-1)!.text.match(/invitations\/([A-Za-z0-9_-]{43})/)![1]!
```

En `accounts`, después del primer test, uno de que los eventos siguen al reloj: un
suscriptor `fire-and-forget` guarda el `occurredAt` de `user.signedUp`, y es la hora que
fijó el test, no la real:

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

Después del test que abre una sesión al registrarse: una sesión que termina
por el reloj, y la purga nocturna:

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

El primer test mueve el reloj un día menos que los días de la sesión, y luego un día más.
Sin esperar.

El segundo empieza a mediodía del día fijo de `beforeEach`, donde ya estuvo la primera
mirada de la programación. Detiene el bucle de programaciones propio de auth con
`base.schedules.stop()`: el bucle despierta al menos una vez por minuto y vería el reloj
movido, y un tic que contara mientras el test también los cuenta competiría con los del
test. Desde ahí, solo el test cuenta tics. Luego Ana se registra (una sesión que caduca 30
días después, a mediodía), el reloj avanza esos 30 días, y ella inicia sesión de
nuevo (una segunda sesión). Pasaron treinta noches a las tres sin que se contara ningún
tic; el siguiente `tick()` cuenta uno, el último. Su job se ejecuta en `settled()`, y de
las dos sesiones desaparece la caducada.

El test del borrado de un workspace ahora comprueba también sus invitaciones. Cámbiale el
nombre, e invita a alguien antes de borrar:

```ts
// cooper/backend/contexts/auth/auth.test.ts
  test('takes every access and invitation away once deleted, from its workers', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await as(ana, () => modules().invitation.create(acme.id, { email: 'cai@cooper.test' }))
```

Y al final del archivo, las invitaciones:

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

- El primer test sigue una invitación de principio a fin. Cuando `create` responde no ha
  salido ningún email; sale en `settled()`, desde el worker. Eve tiene el enlace pero otro
  email; Bob acepta, y es miembro. Un segundo accept la encuentra cerrada.
- El segundo mueve el reloj los días de la invitación. Nada espera una semana.
- El tercero detiene el worker de auth, así que los jobs de `tenant.deleted` no se
  ejecutan, y borra el workspace. La invitación todavía dice pendiente, y `accept` la
  rechaza igualmente: comprueba el workspace. Cuando los jobs se ejecutan, Bob no tiene
  acceso.
- El cuarto comprueba la parte del admin: solo ella invita, una vez por email, y un
  miembro no es invitado de nuevo.
- El quinto llama a `send` por segunda vez, como haría un job ejecutado dos veces: un
  segundo enlace, y el primero no se encuentra.

## Compruébalo

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

```text
 98 pass
 0 fail
```

Los tests de este capítulo por separado:

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

Luego la programación, a mano. Arranca el backend (`bun cooper/backend/index.ts`), páralo
con Ctrl+C cuando diga que está escuchando, y mira la base de datos de auth:

```sh
sqlite3 data/cooper-auth.db 'select * from schedule_tick'
```

```text
session.nightly|2026-10-26T03:00:00.000Z|1
```

La programación se vio por primera vez: registró el último tic que tocaba (las tres de esta
madrugada, UTC; tu fecha será otra) y no contó nada. El siguiente es el de esta noche.

## Qué recordar

- El tiempo es una dependencia. El `Base` de un contexto toma un `clock`; tu código pregunta
  a `now()`, nunca a `new Date()`. Un test da `{ now: () => new Date(time) }` y mueve
  `time`.
- Lo que toca a una hora es una programación: `base.schedules.define(name, cron)`, en UTC,
  que ofrece su módulo como sus eventos, y a la que se suscribe con el mismo `subscribe`.
  Un `handler` hace de cada tic un job, intentado hasta que lo consigue.
- Cada tic se cuenta una vez, por el primer proceso que lo registra; los tics perdidos se
  cuentan como uno; una programación nueva espera a su siguiente tic. Un test llama a
  `base.schedules.tick()` después de mover su reloj, una vez detenido el bucle propio del
  contexto (`base.schedules.stop()`).
- Un secreto se hace donde sale, nunca se guarda en un job: el store guarda solo su hash.
  Enviado dos veces, el segundo enlace es el que funciona.
- Un caso de uso que comprueba algo que una saga cambiará, como `accept` comprueba el
  workspace, no espera a los workers de la saga.

Siguiente: [Conectar los contextos](./20-wiring-contexts).
