# Tenants y acceso

boards trabaja en workspaces: cada tablero, columna y tarjeta tiene un `workspaceId`, y
los scopes del capítulo 4 hacen que una petición solo vea los suyos. Pero nada en cooper
dice qué es un workspace, quién lo creó ni quién puede entrar en él. boards sigue
preguntando a `FakeAuth`, al que `open-contexts.ts` le dice a mano que Ana y Carl están en
acme y Bea en globex.

Ese conocimiento es de auth, el contexto que sabe quién es cada persona. Este capítulo le
da a auth dos módulos:

- **`tenant`**: los workspaces en sí. auth los llama tenants, porque auth sirve a varios
  productos y un tenant es aquello en lo que un producto divide a sus clientes; boards
  sigue llamándolos workspaces. Quien crea uno es su único admin.
- **`access`**: quién puede entrar en qué producto, y dónde. Un acceso es una persona, un
  producto y un tenant: Ana puede entrar en `cooper` en Acme. O una persona y un producto
  sin tenant (`tenantId` null): el personal puede entrar en todo el `backoffice`.

Dos de sus reglas son de un tipo nuevo. Crear un workspace da a quien lo crea el acceso de
admin **en la misma petición**, aunque eso sea una escritura en otro módulo. Y un acceso
se da **una sola vez**, lo den cuantos lo den a la vez, algo que la versión de una fila no
puede proteger: la segunda fila es nueva, no tiene versión con la que comparar. Un índice
único en una migración nueva sí, y el caso de uso aprende qué hacer cuando responde
`DuplicateValue`.

El personal buscará cuentas y workspaces desde el backoffice (capítulo 25). Así que `user`
y `tenant` reciben cada uno un `list` que toma un filtro de un cliente, cerrado con
`defineFilter`.

Nada de esto se sirve aún por HTTP: boards empieza a preguntar a auth en el [capítulo
20](./20-wiring-contexts), y las rutas llegan con los frontends. Los tests usan los
módulos directamente.

## Las tablas

Dos migraciones, junto a `00001_user` y `00002_session` del capítulo 17. Primero los
workspaces. Un workspace borrado conserva su fila, marcada con `deleted_at`: otros
contextos pueden seguir teniendo su id, en lo que guardaron de él.

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

Los accesos. `tenant_id` puede ser null: un acceso a todo el producto. Dos índices, para
las dos formas de leerlos: los accesos de alguien a un producto (`check`, en cada petición
que entra) y los miembros de un tenant por rol (su admin).

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

Todavía no hay un índice único sobre quién tiene qué acceso. Llega en su propia
migración, cuando hayas visto la carrera que cierra.

## Un producto es una referencia: `product.find`

Un acceso nombra un producto por su id, y `access` debe rechazar uno que no existe: `nope`
no es un producto. Los productos del capítulo 17 viven en código, en el módulo `product`,
que es el único que los conoce.

Un caso de uso comprueba los ids a los que apunta su entrada con
`this.resolveRefs(ids, finders)`. Para cada clave pregunta al finder dado para ella, y
lanza `ReferenceNotFound` (un 400, `reference_not_found`, capítulo 3) por un id que el
finder no encuentra. Un finder es cualquier cosa con un `find({ id: [...] })` que devuelve
lo que encontró, cada elemento con un `id` y un `name`; un id `null` significa "ninguno" y
no se busca. Un módulo con tabla ya tiene ese `find` a través de su repositorio;
`product` no tiene tabla, así que añade uno después de `get`:

```ts
// cooper/backend/contexts/auth/modules/product/product.module.ts
  /** For `resolveRefs`: the products with these ids, as any module's `find` gives them. */
  @UseCase()
  async find(criteria: { id: string[] }): Promise<ProductDTO[]> {
    return this.products.filter(product => criteria.id.includes(product.id)).map(product => structuredClone(product))
  }
```

`resolveRefs` comprueba que la referencia existe, nada más. Una comprobación que necesita
más (la persona es miembro de este workspace) es una pregunta aparte, como la hace
`access` más abajo.

## El módulo access

Un acceso es pequeño: un usuario, un producto, un tenant o ninguno, y un rol. Un tenant
tiene un `admin`, que lo creó, y cualquier número de `member`s. Crea
`cooper/backend/contexts/auth/modules/access/access.schema.ts`. Además del DTO tiene dos
entradas: lo que alguien pide cuando da un acceso (`grant`: el rol es siempre `member`), y
lo que auth da por su cuenta, con el rol (`admit`).

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

La entidad, `access.ts`. Se concede y se revoca; nada más le pasa a un acceso. Revocar lo
borra del todo: el repositorio de abajo no tiene `softDelete`, así que su fila desaparece.
Un acceso es la llave de una puerta, no historia.

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

Sus dos eventos, en `events/`:

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

Sus errores, en `errors/`. Dos son `NotFoundError` a propósito. `NotAMember` es lo que
oye quien está fuera de un workspace cuando intenta gestionarlo: "no hay ningún
workspace", un 404. Algo privado nunca dice que existe a quien no puede verlo. Quien está
dentro pero no es su admin oye `NotAdmin`, un 403: ya sabe que existe.

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

Usa un solo módulo más, `product`:

```ts
// cooper/backend/contexts/auth/modules/access/access.deps.ts
import type { Product_Module } from '../product/product.module'

export interface Access_Deps {
  product: Product_Module
}
```

### Un admin por tenant, bajo un guard

"Un tenant tiene un admin" es una regla sobre varias filas, como lo era "el nombre de un
tablero es único en su workspace" en el [capítulo 6](./06-rules-over-rows). La herramienta
es la misma: un guardado con un hook `after` que cuenta, en la transacción, después de las
escrituras, bajo un guard que mantiene fuera cualquier otro guardado de la misma regla
hasta que haga commit. El repositorio:

```ts
// cooper/backend/contexts/auth/modules/access/access.repository.ts
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { TenantHasAdmin } from './errors/tenant-has-admin'
import { Access, type AccessDTO } from './access'

export type AccessRow = AccessDTO & { version: number }

export class Access_Repository extends TableRepository<Access, AccessRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: a person's accesses span tenants (and the staff's belong to none); the use cases ask who may see them.
    super(base, base.store.table<AccessRow>('access'), { scope: 'none' })
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

`persistKeepingOneAdmin` protege dos clases de clave:

- `tenantAdmin:<tenant>`, para cada tenant que toca el guardado. Dos guardados que dan un
  admin a Acme a la vez se turnan, y el `after` del segundo cuenta dos admins y lanza
  `TenantHasAdmin`, que deshace su guardado.
- `access:<user>:<product>:<tenant>`, para cada acceso. Esta no comprueba nada en
  `after`: solo hace que dos guardados del mismo acceso se esperen. Lo que rechaza al
  segundo es el índice de la sección siguiente.

El comentario dice por qué la tabla no declara `unique` (la del tablero del capítulo 6
sí). Los stores SQL ignoran esa opción, porque sus índices lo dicen, y el store de
archivos, el único que la respeta, deja que dos filas con el campo null compartan el
valor. Los accesos del personal tienen tenant null, así que en el store de archivos
quedarían sin proteger. El índice lo dice en todos los stores SQL, null incluido.

Su ámbito es `'none'`, como el de todo repositorio de auth (capítulo
[17](./17-auth)): los accesos de una persona abarcan varios tenants, y los del personal
no son de ninguno. Los casos de uso preguntan quién puede verlos.

### Dado una vez: un índice único y `DuplicateValue`

Dos personas dan a Bob acceso a Acme a la vez. Las dos buscan un acceso existente, no
encuentran ninguno y guardan una fila nueva. Ninguna fila tiene versión con la que
chocar: las dos son nuevas. El guard hace que el segundo guardado espere al primero, y
luego lo deja escribir su fila. Hasta aquí nada impide que Bob tenga dos accesos a Acme.

Un índice único sí. Añade una tercera migración:

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

Va sobre una expresión, `ifnull(tenant_id, '')`, no sobre la columna. En SQL, dos nulls
nunca son iguales, así que un simple `UNIQUE (user_id, product_id, tenant_id)` dejaría
que la misma persona tuviera dos veces todo el `backoffice`. Contar null como cadena vacía
hace del acceso del personal un valor como cualquier otro.

¿Por qué una migración nueva y no una línea más en `00004_access`? Porque `00004` puede
estar ya aplicada, en tu máquina o en un servidor. Una migración que ya se ejecutó no se
edita nunca: newt guarda el checksum de cada script up que aplicó, y se niega a seguir si
alguno ha cambiado desde entonces. Un cambio en el esquema es un archivo nuevo, con su
`down`.

Con el índice, la segunda fila se rechaza **al escribirla**, antes de que corra `after`.
El store lanza `DuplicateValue`, un `ConcurrencyConflict` propio (`duplicate_value`, 409).
El capítulo 6 dejó que el caso de uso se ejecutara otra vez con él, una vez, para que su
propia comprobación encontrara el nombre del tablero ya cogido y respondiera con su propio
error. Aquí ejecutar otra vez no siempre es posible, como muestra la sección siguiente, ni
hace falta: un acceso dado dos veces no es un error, está dado. Así que el caso de uso lo
captura.

### El módulo

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

Los casos de uso, desde arriba:

- **`check`** es lo que todo contexto preguntará antes de dejar entrar a alguien: el
  acceso de esta persona a este producto, en este tenant (o en todo el producto), o null.
  Se pregunta en cada petición, nunca se guarda, así que un acceso retirado cuenta al
  instante.
- **`listForTenant`, `listForProduct`, `listForUser`** listan por tenant, por producto sin
  tenant (el personal) y por persona. `repo.page` va por id, el más antiguo primero, así
  que el admin de un tenant, su primer acceso, encabeza su lista.
- **`grant`** es una persona dando un acceso, como el actor con sesión: el admin de un
  workspace a su workspace, alguien del personal a todo el producto. Resuelve el producto,
  comprueba que el actor lo gestiona (`assertManages`) y da un acceso `member`.
- **`revoke`** quita uno. Puede el admin del workspace, y también un miembro que quita el
  suyo (`leaving`): irse no necesita permiso de nadie. El acceso del propio admin nunca se
  quita: un workspace conserva a su admin mientras existe.
- **`admit`** es auth dando un acceso por su cuenta, una vez que algo más ha decidido
  quién puede tenerlo: quien crea un workspace nuevo (más abajo), el miembro que hace una
  invitación aceptada (capítulo 19), el primer personal que crea un script. No comprueba
  ningún actor, así que ninguna ruta lo sirve: solo lo llama el código de auth.
- **`revokeTenant`** quita todos los accesos a un tenant, para su borrado.

`grant` y `admit` comparten `give`, que es donde vive el "una vez". Primero busca el
acceso, y si está lo devuelve: dar dos veces seguidas es dar una. Luego guarda. Si el
guardado lanza `DuplicateValue`, otro guardado dio el mismo acceso mientras tanto; `give`
lo lee y lo devuelve, como si lo hubiera encontrado desde el principio. Cualquier otro
error, o un `DuplicateValue` sin nada detrás, sigue su camino hacia arriba.

Eso hace que `admit` se pueda ejecutar otra vez sin riesgo, incluso a la vez que otra
ejecución de sí mismo: justo lo que necesita un worker, y de lo que depende el módulo
siguiente.

Mira también el orden dentro de un guardado. Si se admite un segundo admin para Acme, su
fila es nueva (otro usuario), el índice no tiene nada en contra y `after` cuenta dos
admins: `TenantHasAdmin`. Si el propio admin de Acme se admite dos veces a la vez, el
índice rechaza la segunda fila antes de que `after` cuente nada, y `give` devuelve el
admin que ya está. Sin el índice, esa segunda fila llegaría hasta `after`, y el mismo
admin, admitido dos veces, se rechazaría como segundo admin. Lo verás exactamente así
cuando quites el índice, al final del capítulo.

## El módulo tenant

`cooper/backend/contexts/auth/modules/tenant/tenant.schema.ts`. Un workspace tiene un
nombre y a quien lo creó, `createdBy`, su único admin.

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

### Por qué puede buscar el personal: `TenantFilter`

El backoffice listará todos los workspaces, y su personal filtrará: por nombre, por admin,
por cuándo se crearon. Un filtro viene de un cliente, así que está cerrado, como lo estaba
`CardFilter` en el [capítulo 15](./15-kysely): `defineFilter` da a cada nombre público
(`admin`) el campo al que apunta (`createdBy`), los operadores que permite y límites de
cuánto pueden anidarse los grupos y cuántas condiciones tiene un filtro.
`TenantFilter.schema` valida lo que envía un cliente, rechazando cualquier campo u
operador no declarado, y `TenantFilter.toCriteria` convierte lo que pasó en criterios para
el repositorio. `id`, `deletedAt` y `version` no están en la lista, así que ningún cliente
filtra por ellos.

La entidad, `tenant.ts`. Se crea, se renombra y se borra, y cada cosa cuenta un evento:

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

Los eventos, en `events/`. `tenant.created` y `tenant.deleted` llevan el workspace entero;
otros contextos guardan de ellos lo que necesitan. Son los eventos a los que reaccionan
las sagas de boards del [capítulo 14](./14-sagas): su tablero de bienvenida con
`tenant.created`, su purga con `tenant.deleted` (el capítulo 20 los conecta). En auth,
`tenant.deleted` inicia una saga propia, más abajo.

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

Los errores:

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

El repositorio borra de forma suave, como los tableros del capítulo 2: un workspace
borrado conserva su fila, y ningún `find`, `first`, `page` ni `count` lo ve. Tampoco
tiene ámbito: son los tenants mismos, no filas dentro de uno.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.repository.ts
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Tenant, type TenantDTO } from './tenant'

export type TenantRow = TenantDTO & { version: number, deletedAt: string | null }

export class Tenant_Repository extends TableRepository<Tenant, TenantRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: these are the tenants themselves; the use cases ask who may see each one.
    super(base, base.store.table<TenantRow>('tenant'), { softDelete: true, scope: 'none' })
  }

  protected toEntity(row: TenantRow): Tenant {
    return Tenant.fromDTO(row)
  }
}
```

El módulo conoce a `access`, y se le dice a qué producto pertenecen sus tenants. auth
sirve a más de un producto; los workspaces son de `cooper`.

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

### Sus workers

Dos suscripciones `handler`, cada una con su cola con el nombre de lo que hace
(`<módulo>.<casoDeUso>.on.<evento>`), como en el [capítulo 11](./11-reacting). El job de
cada evento se escribe en la misma transacción que el workspace, y se ejecuta hasta que
se completa.

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

- Con `tenant.created`, `ensureAdmin` admite a quien lo creó como admin. La petición ya
  lo hizo (más abajo); esto es por si se detuvo entre sus dos guardados.
- Con `tenant.deleted`, `removeAccesses` quita todos los accesos al workspace. La petición
  también lo hizo ya; esto es por si se detuvo, o si alguien entró entre los dos
  guardados de la petición.

Los dos llaman a casos de uso de `access` que se pueden ejecutar otra vez sin riesgo:
`admit` da una vez, `revokeTenant` no encuentra nada la segunda vez.

### El módulo

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
import { Tenant, TenantCreateSchema, TenantFilter, TenantRenameSchema, type TenantDTO } from './tenant'
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
  async create(input: unknown): Promise<TenantDTO> {
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
  async rename(tenantId: string, input: unknown): Promise<TenantDTO> {
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

`get`, `getMany`, `list` y `listForUser` leen. `get` no comprueba ningún actor: es para
un contexto que ya decidió quién puede ver el workspace. `listForUser` lee los accesos de
alguien a `cooper`, una página de ellos, y los workspaces a los que apuntan; `mapPage`
deja fuera un elemento para el que su función devuelve `undefined`, así que un workspace
borrado mientras se leía no está en la página. `list` es del personal: `filter` es
`unknown`, porque viene de un cliente, y `TenantFilter.schema.parse` es lo que le da un
tipo, o un 400. `create` y `rename` reciben `input: unknown` por lo mismo y lo parsean
con sus esquemas: una ruta les pasará un cuerpo tal como llegó (capítulo
[20](./20-wiring-contexts)).

`rename` y `delete` son del admin. `assertAdmin` pregunta a `access.check`: ningún acceso
es `TenantNotFound`, un acceso que no es el del admin es `NotTenantAdmin`.

### `create`: una escritura en otro módulo, y nunca dos veces

`create` guarda el workspace y luego da a quien lo crea el acceso de admin. Son dos
módulos y dos transacciones. La regla del [capítulo 8](./08-two-people-one-card) dice que
un caso de uso escribe en otro módulo solo desde un worker: si el segundo guardado
fallara, el primero se quedaría, y nada terminaría el trabajo. `create` rompe la regla a
propósito, y lo dice donde se ve:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
  @UseCase({ writesTo: ['access'], retryOnConflict: false })
  async create(input: unknown): Promise<TenantDTO> {
```

**`writesTo: ['access']`.** Quien crea un workspace debe poder entrar en él en el momento
en que llega la respuesta; un worker daría el acceso un instante después, y su primera
petición dentro sería rechazada. Así que la petición lo da ella misma. ¿Y si falla después
de guardar el workspace? Entonces lo da el worker de `tenant.created`, cuyo job se
escribió con el workspace. El motivo de la regla sigue en pie: el trabajo siempre se
termina. Solo que lo termina la petición en el caso normal, y el worker cuando la petición
no llegó. Sin `writesTo`, la regla de escritura de newt rechaza el guardado de
`access.admit`, como mostró el capítulo 14.

**La carrera que esto crea.** El job del worker se escribe con el workspace. El worker del
contexto puede cogerlo en cuanto ese guardado hace commit, mientras la petición todavía
está llamando a `admit`. Los dos dan el mismo acceso a la vez. Un guardado gana; la fila
del otro la rechaza `access_once` como `DuplicateValue`, y `give` devuelve el acceso que
ya está. Un admin, los dos llamantes contentos.

**`retryOnConflict: false`.** Por defecto, un caso de uso que encuentra un
`ConcurrencyConflict` se ejecuta otra vez desde arriba, con todo lo que llama (capítulo
8). Para `create`, arriba está `Tenant.create`: un workspace nuevo, con un id nuevo,
guardado una segunda vez. La persona tendría dos Acme. Así que `create` dice que nunca se
ejecuta otra vez, y el comentario dice por qué. Con eso, nada de su cadena se ejecuta otra
vez tampoco, `admit` incluido: un `admit` llamado por `create` no puede contar con que se
ejecute otra vez para encontrar el acceso dado. Por eso `give` maneja `DuplicateValue` por
sí mismo, y no se lo deja a una segunda ejecución.

`delete` sigue el mismo patrón, al revés: nadie debe poder entrar en un workspace borrado
desde el momento en que responde, así que quita los accesos en la petición
(`writesTo: ['access']`), el worker de `tenant.deleted` es su respaldo, y una segunda
ejecución encontraría el workspace ya borrado y respondería 404 a un borrado que funcionó
(`retryOnConflict: false`).

## Cuentas que el personal puede buscar: `UserFilter`

El backoffice lista también las cuentas. En `user.schema.ts`, importa `defineFilter` junto
a `Email`:

```ts
// cooper/backend/contexts/auth/modules/user/user.schema.ts
import { defineFilter, Email } from 'newt/contract'
```

y declara por qué puede filtrar cuentas el personal, después de `UserSignUpSchema`, con
su tipo después de los demás:

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

`passwordHash` es un campo de la fila. No está en el filtro, así que ningún cliente puede
pedir "las cuentas cuyo hash empieza por…". Ese es el sentido de una lista cerrada: el
filtro decide qué se puede preguntar, no la tabla.

En `user.module.ts`, los imports crecen:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
import { Email, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
// …
import { User, UserFilter, UserSignUpSchema, type UserDTO, type UserSignUpDTO } from './user'
import { User_Repository, type UserRow } from './user.repository'
```

y `list` va después de `get`, con la misma forma que `tenant.list`:

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

## Conectarlos

`initialize-modules.ts` inicializa los dos módulos, cada uno después de lo que usa:
`access` después de `product`, `tenant` después de `access`. Impórtalos:

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
import { Access_Module } from './modules/access/access.module'
import { Product_Module } from './modules/product/product.module'
import { PRODUCTS, WORKSPACES_PRODUCT, type ProductDTO } from './modules/product/product.schema'
import { Session_Module } from './modules/session/session.module'
import { Tenant_Module } from './modules/tenant/tenant.module'
import { User_Module } from './modules/user/user.module'
```

y añádelos a `initializeModules`. Los tenants son los de `WORKSPACES_PRODUCT`, `cooper`:

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

Dos comentarios dicen qué guarda ahora auth. En `auth.context.ts`:

```ts
// cooper/backend/contexts/auth/auth.context.ts
/**
 * Who someone is: accounts, workspaces (tenants), who may enter which app, and who
 * is signed in. It uses no other context.
 */
```

y en `config.ts`:

```ts
// cooper/backend/config.ts
  /** Who someone is: accounts, workspaces, who may enter what, and who is signed in. */
```

`Auth_Context.open` ya ejecuta todas las migraciones de `migrations/sqlite/`, así que las
tres nuevas se aplican la próxima vez que se abra.

## Los tests

`auth.test.ts` recibe un actor para los casos de uso que lo necesitan, y una forma de
esperar a los workers. Añade los imports:

```ts
// cooper/backend/contexts/auth/auth.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runAsActor } from 'newt/core'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Auth_Context } from './auth.context'
import type { UserDTO } from './modules/user/user.schema'
```

y los helpers, alrededor de `signUp`. `settled` espera a que se hayan ejecutado los jobs
que escribieron los commits (`jobs.idle()`, capítulo 11); `as` ejecuta una llamada como
alguien con sesión en la web; `page` es la página que pide cada lista.

```ts
// cooper/backend/contexts/auth/auth.test.ts
const modules = () => auth.modules
/** Until the background work is done: the jobs the commits wrote, run. */
const settled = () => auth.base.jobs.idle()
const signUp = (name: string, email = `${name.toLowerCase()}@cooper.test`) => modules().user.signUp({ email, name, password: 'a long password' })
const as = <T>(user: UserDTO, fn: () => Promise<T>) => runAsActor({ userId: user.id, via: 'web' }, fn)
const page = { size: 20 }
```

En `accounts`, después de *opens a session at sign-up, unless the product takes no new
accounts* (antes del test sobre HTTP), uno para `user.list`. Un filtro sobre un campo que
`UserFilter` no declara no se puede validar: la promesa del caso de uso se rechaza con
un `ZodError`, así que el test la espera con `await`.

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

Luego un `describe` nuevo, al final del archivo. Los primeros tests son la vida del
workspace: creado con su admin al instante, y el worker que lo encuentra ya ahí;
renombrado solo por su admin, con un 404 para alguien de fuera y un 403 para un miembro;
un admin que se queda, y miembros que se quitan o se van.

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

Los dos siguientes son las carreras. Tres `give` del mismo acceso a la vez, dos del admin
y uno de la propia auth, dejan a Bob con uno: Acme tiene dos accesos, el de su admin y el
de Bob. Dos `admit` del mismo acceso del personal, sin tenant, dejan también uno: eso es
el `ifnull` del índice. Después la carrera de `create` y su worker, montada a mano: un
suscriptor `fire-and-forget` se ejecuta justo después de que haga commit el guardado del
workspace, en este proceso, mientras `create` aún está dando el admin, como puede hacerlo
el worker en producción.

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

El acceso del personal a todo el `backoffice` lo da el personal, y un producto que no
existe es un `reference_not_found` de `resolveRefs`:

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

Borrado, dos veces. Una con sus workers en marcha: se van todos los accesos, cada uno
contando `access.revoked`. Y otra con el worker del contexto parado (`jobs.stop()`), para
mostrar que la petición sola ya no deja entrar a nadie: el worker es el respaldo, no el
borrado. Por último, la lista del personal de todos los workspaces, con su filtro.

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

En el primer test de borrado, `told` tiene a Ana y a Bob: la petición revocó a los dos, y
el worker no encontró nada que revocar. El admin nunca lo revoca `revoke`, pero
`revokeTenant` se lleva también el suyo: el workspace ya no existe.

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 90 pass
 0 fail
```

Los tests sobre "una vez", solos:

```sh
bun test cooper/backend/contexts/auth -t 'once'
```

```text
 4 pass
 10 filtered out
 0 fail
```

Ahora mira qué hace el índice quitándolo. Saca los dos archivos de `00005_access-once` de
`migrations/sqlite/` y ejecuta los tests de auth (cada test abre auth sobre una base
`:memory:` nueva, así que el índice simplemente no se crea):

```sh
mkdir -p /tmp/away && mv cooper/backend/contexts/auth/migrations/sqlite/00005_access-once_* /tmp/away/
bun test cooper/backend/contexts/auth
```

Fallan dos tests (la salida está recortada). Los tres `give` a la vez dejan cuatro accesos
donde debería haber dos: el de Ana, y el de Bob tres veces, porque cada `give` miró antes
de que ninguno guardara, y el guard solo hizo que los guardados se turnaran. Y la carrera
de `create` y su worker acaba en un error:

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

El segundo fallo es el orden de comprobaciones que viste en el módulo access: sin índice,
la segunda fila del mismo admin llega hasta `after`, que cuenta dos admins. Devuelve los
archivos a su sitio:

```sh
mv /tmp/away/00005_access-once_* cooper/backend/contexts/auth/migrations/sqlite/
```

Por último, el índice en una base real. Arranca el backend una vez (`bun
cooper/backend/index.ts`), para que auth aplique sus tres migraciones nuevas a
`data/cooper-auth.db`, y páralo (Ctrl-C). Luego pregunta a SQLite:

```sh
sqlite3 data/cooper-auth.db ".indexes access"
```

```text
access_once                access_user              
access_tenant              sqlite_autoindex_access_1
```

y escribe el mismo acceso del personal dos veces, a espaldas del módulo:

```sh
sqlite3 data/cooper-auth.db "INSERT INTO access VALUES ('by-hand-1', 'nobody', 'backoffice', NULL, 'member', '', '', 1)"
sqlite3 data/cooper-auth.db "INSERT INTO access VALUES ('by-hand-2', 'nobody', 'backoffice', NULL, 'member', '', '', 1)"
```

```text
Error: stepping, UNIQUE constraint failed: index 'access_once' (19)
```

La primera fila entra; la segunda, con el mismo tenant null, no. Lo escriba quien lo
escriba en la tabla, el módulo u otra cosa, un acceso existe una sola vez. Borra la fila
que escribiste:

```sh
sqlite3 data/cooper-auth.db "DELETE FROM access WHERE user_id = 'nobody'"
```

## Qué recordar

- Un caso de uso que escribe en otro módulo fuera de un worker lo dice con `writesTo`, y
  un worker del mismo evento termina el trabajo si la petición se detiene a medias. Úsalo
  cuando la persona necesita el resultado en la respuesta: quien crea un workspace entra
  en él al instante.
- `retryOnConflict: false` es para un caso de uso que no debe ejecutarse dos veces:
  `tenant.create` haría un segundo workspace. Desactiva los reintentos de toda su cadena,
  así que lo que llama debe manejar sus propios conflictos.
- Una regla sobre filas nuevas no tiene versión que la proteja. Un índice único rechaza la
  segunda fila como `DuplicateValue`; un caso de uso para el que "dado dos veces" significa
  "dado una vez" lo captura y devuelve lo que hay. Null nunca es igual a null en un
  índice: dilo como un valor (`ifnull`) cuando lo es.
- Un cambio en el esquema es una migración nueva. Una que ya se ejecutó no se edita nunca.
- Un filtro que envía un cliente se cierra con `defineFilter`: nombres públicos,
  operadores por campo, límites. Lo que no se declara, `passwordHash` por ejemplo, no se
  puede preguntar.

Siguiente: [Invitaciones y tiempo](./19-invitations-and-time).
