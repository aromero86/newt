# Un tercer contexto que lee de dos

El personal de cooper trabaja para la empresa que lo gestiona. Necesita una consola
propia: todos los workspaces, todas las cuentas, quién es del personal y, más adelante,
unas cifras y los jobs que fallaron. Nada de eso pertenece a un workspace, y nada es un
dato nuevo. auth guarda las cuentas y los workspaces; boards guarda lo que hay en ellos.

Este capítulo construye `backoffice`, el tercer contexto. Guarda casi nada: solo las
sesiones web del personal que inicia sesión en él. Cada pantalla se compone con los casos
de uso de los contextos que saben. Hay cuatro novedades:

- **Un contexto que usa a dos.** El lint dice `backoffice: ['auth', 'boards']`, y al
  backoffice se le da un `Pick` de los módulos de cada uno: sus casos de uso, nunca una
  base ni un store.
- **Una comprobación delante de cada ruta.** Un grupo con prefijo `''` cuyo middleware
  pregunta a `staff.enter`: 401 a nadie, 403 a quien no sea del personal, y en el mismo
  instante en que le quitan el acceso.
- **Leer otros contextos por sus casos de uso**, de página en página, con un puñado de
  llamadas por página y nunca una por fila.
- **Iniciar sesión por el OAuth de auth, como hace boards**: la sesión web del [capítulo
  22](./22-web-session), como el cliente OAuth `backoffice`.

El frontend del backoffice espera al [capítulo 26](./26-dead-jobs-and-analytics): su
resumen y su página de jobs leen dos módulos que añade ese capítulo. Hasta entonces el
backoffice es su API, y sus tests la comprueban, iniciando sesión por auth de extremo a
extremo.

## Su configuración

El backoffice se abre como los demás: un puerto, una base de datos, dónde se abre, dónde
se inicia sesión, el secreto de su cliente OAuth. auth nombra al backoffice desde el
[capítulo 17](./17-auth): `publicUrls.backoffice` y `clientSecrets.backoffice` ya están en
`config.ts`, y auth declaró el producto `backoffice`, con su cliente OAuth, en el
[capítulo 21](./21-oauth-server). Añade la parte del backoffice a `config`, después de
`boards`:

```ts
// cooper/backend/config.ts
// …
    /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND ?? 'dist/cooper/boards'),
  },
  /** The staff's console. */
  backoffice: {
    /** `COOPER_BACKOFFICE_PORT`: where it listens. */
    port: Number(env.COOPER_BACKOFFICE_PORT ?? 3003),
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
}
// …
```

y su tipo, en una carpeta nueva `contexts/backoffice`:

```ts
// cooper/backend/contexts/backoffice/backoffice-config.ts
import type { Config } from '../../config'

/** The settings of `backoffice`, from `config.ts`. */
export type Backoffice_Config = Config['backoffice']
```

## Su base de datos: solo las sesiones

La sesión web guarda sus sesiones en la base de datos propia del contexto. En el
[capítulo 22](./22-web-session) boards copió la migración de `shared/web-session` en su
propia carpeta. El backoffice hace lo mismo; no tiene otra tabla, así que es su primera
migración:

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

## El personal

En auth, un acceso dice quién puede entrar en qué producto, para qué tenant ([capítulo
18](./18-tenants-and-access)). Un miembro de Acme tiene acceso al producto `cooper` para
el tenant Acme. Alguien del personal tiene acceso al producto `backoffice` para **ningún
tenant**: `tenantId` es `null`. El personal mira todo cooper, no un workspace.

Así que el backoffice no guarda quién es del personal. Lo guarda auth. El módulo `staff`
del backoffice se lo pregunta a auth cada vez, y da o quita el acceso con los casos de uso
de auth.

### Sus errores

Tres errores, en `modules/staff/errors/`. El primero es el que puede responder cualquier
ruta:

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

En boards, un workspace al que no perteneces es un 404: un 403 le diría a un extraño que
el workspace existe. El backoffice responde 403, y dice por qué. Puede: el 403 llega antes
de leer nada, para cualquier ruta, así que no revela qué workspaces o cuentas existen. Y
quien lo recibe inició sesión en el backoffice, así que el backoffice no es ningún secreto
para él.

Los otros dos tratan de conceder y quitar:

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

### Qué recibe

Las opciones del módulo dicen cuál es el producto backoffice. Es el nombre que le da auth,
y el contexto se lo pasa:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff-options.ts
/** What the context configures the staff with. */
export type Staff_Options = {
  /** The backoffice as a product of auth's: its staff have access to it for no tenant. */
  productId: string
}
```

Sus deps son dos módulos de auth, por sus clases, como el módulo workspace de boards
nombraba los de auth en el [capítulo 20](./20-wiring-contexts):

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.deps.ts
import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'

/** auth's modules, called through their use cases: auth keeps who the staff are. */
export interface Staff_Deps {
  /** The accounts: who someone of the staff is, and whose an email is. */
  user: AuthUser_Module
  /** Who may enter the backoffice, asked every time; and giving or taking that away. */
  access: Access_Module
}
```

El backoffice tiene un módulo `user` propio (más abajo), así que el de auth se importa como
`AuthUser_Module`.

### Sus formas

Alguien pasa a ser del personal por el email de su cuenta. Un miembro del personal, como lo
muestra la lista, es su cuenta y la fecha de su acceso:

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

El `id` del DTO es el del acceso, no el del usuario: la lista avanza de página en página
por el id del acceso (`listForProduct` pagina accesos), así que ese es el id que nombra un
cursor. `name` y `email` toman sus tipos del `UserDTO` de auth: si auth los cambia, esto
falla al compilar, no al ejecutar.

### Una comprobación delante de cada ruta: `staffRoutes`

Cada ruta de la API del backoffice debe comprobar que quien ha iniciado sesión es del
personal, y ninguna puede olvidarlo. En el [capítulo 4](./04-who-and-where) boards resolvió
el mismo problema para los workspaces con un grupo: `http.group(prefix, middleware)`
devuelve un router cuyo middleware se ejecuta alrededor de cada una de sus rutas, después
de comprobar la sesión. Haz lo mismo aquí, en la raíz del backoffice:

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

El prefijo es `''`: el backoffice no tiene un ámbito como el workspace de boards, así que
su grupo no añade ninguna ruta, solo la comprobación. El middleware espera a
`staff.enter()`, que lanza `NotStaff` a cualquier otro, y el router lo responde como
cualquier error de dominio. Ningún caso de uso de más abajo tiene que volver a comprobarlo,
y ninguna ruta puede olvidarlo.

Cada módulo llama a `staffRoutes` y registra sus rutas en lo que devuelve. Cada llamada
crea un grupo propio con el mismo middleware; eso es todo lo que es un grupo.

Las respuestas salen de quién pregunta:

| Quién pregunta | Estado | Por qué |
|---|---|---|
| Nadie con sesión | 401 | El router rechaza toda ruta que no sea `public`, antes del middleware. |
| Alguien con sesión, que no es del personal | 403 | `staff.enter` lanza `NotStaff`, un `ForbiddenError`. |
| El personal, por algo que no existe | 404 | Un workspace o una cuenta que no existe. |

Ahora las rutas propias del personal: listarlo, conceder por email, quitar por id de
usuario:

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

### El módulo

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
    super('staff', base.invocations)
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
    return this.deps.user.get(currentActor().userId)
  }

  @UseCase()
  async isStaff(userId: string): Promise<boolean> {
    return (await this.deps.access.check(userId, this.options.productId, null)) !== null
  }

  /** The staff, the oldest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<StaffMemberDTO>> {
    const accesses = await this.deps.access.listForProduct(this.options.productId, page)
    const users = new Map((await this.deps.user.getMany(accesses.items.map(access => access.userId))).map(user => [user.id, user]))
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
    const user = await this.deps.user.findByEmail(email)
    if (!user) throw new StaffAccountNotFound(email)
    const access = await this.deps.access.grant({ userId: user.id, productId: this.options.productId, tenantId: null })
    return { id: access.id, userId: user.id, name: user.name, email: user.email, since: access.createdAt }
  }

  /** Someone leaves the staff: from then on, the backoffice refuses them. Never oneself. */
  @UseCase()
  async revoke(userId: string): Promise<void> {
    if (userId === currentActor().userId) throw new OwnAccessNotRevocable()
    await this.deps.access.revoke({ userId, productId: this.options.productId, tenantId: null })
  }
}
```

- **`enter`** es la comprobación que ejecuta `staffRoutes`. Pregunta a auth (`isStaff`, que
  es `access.check` para el producto y ningún tenant) en cada petición. No se guarda nada
  en caché, así que un acceso quitado cuenta desde la petición siguiente, no cuando acaba
  una sesión.
- **`me`** es quien ha iniciado sesión, si es del personal. La sesión web lo responde para
  `GET /api/session` (más abajo), así que esa ruta también está comprobada.
- **`list`** pagina los accesos de auth al producto, y luego pide a auth las cuentas de la
  página entera de una vez, con `user.getMany` ([capítulo 20](./20-wiring-contexts)): dos
  llamadas por página, nunca una por fila. `mapPage`, de `newt/core`, transforma cada
  elemento y descarta los que no dan nada (una cuenta que ya no existe).
- **`grant`** recibe `input: unknown`, el cuerpo tal como lo recibió la ruta, y lo parsea
  con `StaffGrantSchema`. Busca la cuenta por email (`user.findByEmail`) y pide a auth
  que conceda el acceso. Un email sin cuenta es `StaffAccountNotFound`: el personal no se registra por el
  producto del backoffice, se registra antes y se le concede después.
- **`revoke`** pide a auth que lo quite, pero nunca el propio: lo hace otra persona, para
  que el backoffice no se quede nunca sin personal.

### Escribir en auth

`grant` y `revoke` cambian los datos de auth. ¿Está permitido? El [capítulo
20](./20-wiring-contexts) fijó una regla para boards: ningún caso de uso de boards escribe
en auth. La razón era un caso de uso que escribe en dos stores, sin nada que termine el
segundo guardado si falla después del primero.

`staff.grant` escribe en un solo store. No escribe nada en el backoffice: su única
escritura es el `access.grant` de auth, un guardado en el store de auth. No hay un segundo
guardado que deje a medias.

Y la regla de escritura de newt ([capítulo 13](./13-another-context)) se cumple donde debe.
Un caso de uso llamado desde otro contexto es la API de ese contexto, como lo sería un
llamante de fuera: `access.grant` es la raíz de lo que ocurre en auth, y se aplican las
reglas de auth. Aquí importan: `access.grant` comprueba que quien ha iniciado sesión
gestiona el producto, es decir, que es del personal él mismo. auth no se fía del
backoffice. Un test más abajo lo prueba: alguien que no es del personal y llama a
`staff.grant` recibe el 403 de auth.

La regla para un contexto que lee de otros, entonces: **lee por sus casos de uso, escribe
por sus casos de uso, y haz que cada escritura sea un guardado en un store.** Una escritura
en tu propio store que se siga de la suya viene de un worker que reacciona a su evento.

## Cuentas

El personal busca cuentas: todas, las más nuevas primero, o por email o nombre. El módulo
`user` del backoffice no guarda ninguna; muestra las de auth.

Su opción nombra el producto cuyos tenants son los workspaces, para contar los workspaces
de alguien:

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
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'
import type { Staff_Module } from '../staff/staff.module'

export interface User_Deps {
  /** That who asks is of the staff, before any route answers; and whether an account is. */
  staff: Staff_Module
  /** auth's accounts, which this module shows: it keeps none. */
  user: AuthUser_Module
  /** The workspaces someone may enter. */
  access: Access_Module
  /** Those workspaces' names. */
  tenant: Tenant_Module
}
```

`staff` está para las rutas (`staffRoutes` lo recibe) y para marcar qué cuentas son del
personal.

Las formas. Lo que busca el personal se comprueba como cualquier entrada. Las respuestas
son el `UserDTO` de auth con lo que añade el backoffice:

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

`PersonDTO` es quién es alguien junto a lo que mira el personal: el admin de un workspace,
un miembro. El módulo workspace también lo usa.

Las rutas. Un texto de búsqueda llega en la query string:

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

Y el módulo:

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
    super('user', base.invocations)
  }

  /** Every account, the newest first, each saying whether it is staff; with a text, those whose email or name it is. */
  @UseCase()
  async list(input: UserSearchDTO, page: PageRequest): Promise<Page<UserSummaryDTO>> {
    const { text } = UserSearchSchema.parse(input)
    const filter: UserFilterDTO | undefined = text
      ? { or: [{ field: 'email', op: 'ieq', value: text }, { field: 'name', op: 'ieq', value: text }] }
      : undefined
    const users = await this.deps.user.list(filter, page)
    // One question to auth per account of the page: a page is short, and auth says it fresh.
    const items = await Promise.all(users.items.map(async user => ({ ...user, staff: await this.deps.staff.isStaff(user.id) })))
    return { ...users, items }
  }

  @UseCase()
  async get(userId: string): Promise<UserDetailDTO> {
    const user = await this.deps.user.get(userId)
    const [staff, workspaces] = await Promise.all([
      this.deps.staff.isStaff(userId),
      this.deps.access.listForUser(userId, { size: 1 }, this.options.workspacesProduct),
    ])
    return { ...user, staff, workspaces: workspaces.total }
  }

  /** The workspaces someone belongs to, the ones they joined last first, with their role in each. */
  @UseCase()
  async workspaces(userId: string, page: PageRequest): Promise<Page<UserWorkspaceDTO>> {
    await this.deps.user.get(userId)
    const accesses = await this.deps.access.listForUser(userId, page, this.options.workspacesProduct)
    const tenants = new Map((await this.deps.tenant.getMany(accesses.items.flatMap(access => access.tenantId ?? []))).map(tenant => [tenant.id, tenant]))
    // A workspace deleted a moment ago, whose accesses are not taken away yet, is left out.
    return mapPage(accesses, access => {
      const tenant = tenants.get(access.tenantId ?? '')
      return tenant && { id: access.id, workspaceId: tenant.id, name: tenant.name, role: access.role, since: access.createdAt }
    })
  }
}
```

- **`list`** convierte el texto en el `UserFilter` de auth ([capítulo
  18](./18-tenants-and-access)): el email o el nombre, enteros, sin importar mayúsculas
  (`ieq`). El filtro es de auth, así que auth decide por qué se puede filtrar; el
  backoffice solo construye uno. Luego pregunta si cada cuenta es del personal. Es una
  pregunta por cada cuenta de la página, a la vez: una página es corta, y la respuesta es
  de auth, fresca.
- **`get`** pregunta dos cosas a la vez: si es del personal, y sus workspaces con una
  página de uno. Solo se usa el `total` de la página. Ninguna lista se devuelve entera, ni
  siquiera a otro contexto, así que contar es una página de uno.
- **`workspaces`** pagina los accesos de alguien al producto `cooper`, y luego pide los
  tenants de la página entera de una vez (`tenant.getMany`). `getMany` deja fuera los
  tenants borrados, así que un workspace borrado hace un momento, cuyos accesos aún no se
  han quitado, no da nada y se descarta. Primero llama a `user.get`: una cuenta que no
  existe es el `UserNotFound` de auth, un 404, no una lista vacía.

## Workspaces

La página de un workspace muestra su nombre, su admin, cuántos miembros y tableros tiene, y
cuántas tarjetas. Eso son los tenants, accesos y cuentas de auth, y los tableros y
tarjetas de boards. El módulo `workspace` del backoffice no es dueño de nada de eso. Sus
deps listan los módulos que sí:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.deps.ts
import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'
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
  tenant: Tenant_Module
  access: Access_Module
  user: AuthUser_Module
  board: Board_Module
  /** How many cards each workspace and board has: Kysely's counts, in boards. */
  card: Card_Module
}
```

Las formas con las que responde, cada una tomando los tipos de sus campos del contexto que
los guarda:

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

Las rutas:

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

`/workspaces/recent-boards` se registra antes que `/workspaces/:workspaceId`, y lo dice:
es una ruta propia, no el workspace cuyo id es `recent-boards`.

Y el módulo:

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
    super('workspace', base.invocations)
  }

  /** Every workspace, the newest first; with a name, those with it. With its admin and its cards. */
  @UseCase()
  async list(input: WorkspaceSearchDTO, page: PageRequest): Promise<Page<WorkspaceSummaryDTO>> {
    const { name } = WorkspaceSearchSchema.parse(input)
    const filter: TenantFilterDTO | undefined = name ? { field: 'name', op: 'ieq', value: name } : undefined
    const found = await this.deps.tenant.list(filter, page)
    return { ...found, items: await this.summaries(found.items) }
  }

  @UseCase()
  async get(workspaceId: string): Promise<WorkspaceDetailDTO> {
    const tenant = await this.deps.tenant.get(workspaceId)
    const [[summary], members, boards] = await Promise.all([
      this.summaries([tenant]),
      this.deps.access.listForTenant(workspaceId, { size: 1 }),
      this.deps.board.listOf(workspaceId, { size: 1 }),
    ])
    return { ...summary!, members: members.total, boards: boards.total }
  }

  /** Its members, the oldest first: its admin leads. */
  @UseCase()
  async members(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceMemberDTO>> {
    await this.deps.tenant.get(workspaceId)
    const accesses = await this.deps.access.listForTenant(workspaceId, page)
    const people = await this.people(accesses.items.map(access => access.userId))
    return mapPage(accesses, access => {
      const person = people.get(access.userId)
      return person && { ...person, id: access.id, userId: person.id, role: access.role, since: access.createdAt }
    })
  }

  /** Its boards, the newest first, each with how many cards it has. */
  @UseCase()
  async boards(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceBoardDTO>> {
    await this.deps.tenant.get(workspaceId)
    const [boards, counts] = await Promise.all([
      this.deps.board.listOf(workspaceId, page),
      this.deps.card.countByBoard(workspaceId),
    ])
    const cards = new Map(counts.map(count => [count.boardId, count.cards]))
    return mapPage(boards, board => ({ id: board.id, name: board.name, description: board.description, createdAt: board.createdAt, cards: cards.get(board.id) ?? 0 }))
  }

  /** The boards created last across every workspace, each with its workspace's name: two calls. */
  @UseCase()
  async recentBoards(): Promise<RecentBoardDTO[]> {
    const boards = await this.deps.board.recentInEveryWorkspace(RECENT_BOARDS)
    const tenants = new Map((await this.deps.tenant.getMany([...new Set(boards.map(board => board.workspaceId))])).map(tenant => [tenant.id, tenant.name]))
    return boards.map(board => ({ id: board.id, name: board.name, workspaceId: board.workspaceId, createdAt: board.createdAt, workspaceName: tenants.get(board.workspaceId) ?? null }))
  }

  /** Workspaces as the list shows them: two calls for the whole page, its admins and its cards. */
  private async summaries(tenants: TenantDTO[]): Promise<WorkspaceSummaryDTO[]> {
    const [admins, counts] = await Promise.all([
      this.people(tenants.map(tenant => tenant.createdBy)),
      this.deps.card.countByWorkspace(tenants.map(tenant => tenant.id)),
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
    const users = await this.deps.user.getMany(userIds)
    return new Map(users.map(user => [user.id, { id: user.id, name: user.name, email: user.email }]))
  }
}
```

Cada caso de uso son unas pocas llamadas a los módulos que saben, ejecutadas a la vez
cuando no dependen una de otra:

- **`get`** pregunta primero y solo a `tenant.get`. Un workspace que no existe lanza el
  `TenantNotFound` de auth, un 404, antes de que se ejecute nada más. Luego tres llamadas a
  la vez: su resumen, y una página de uno de sus miembros y de sus tableros, para sus
  totales. `members` y `boards` empiezan con `tenant.get` por la misma razón.
- **`summaries`** compone una página de workspaces en dos llamadas, sea cual sea su
  tamaño: los admins de la página entera (`user.getMany`), y las tarjetas de cada workspace
  de ella (`card.countByWorkspace`). Preguntar por cada workspace sería una llamada por
  fila. Por eso auth ofrece `user.getMany` y boards ofrece `card.countByWorkspace` con una
  lista de ids: un contexto del que otros leen ofrece sus lecturas por lotes.
- **`boards`** pagina los tableros del workspace (`board.listOf`) y cuenta las tarjetas de
  cada tablero en una sola consulta (`card.countByBoard`), ambas de boards. El [capítulo
  15](./15-kysely) escribió esos conteos con Kysely, para este módulo.
- **`recentBoards`** lee en todos los workspaces a propósito:
  `board.recentInEveryWorkspace` ([capítulo 4](./04-who-and-where)) lo dice en su nombre.
  Luego una llamada para los nombres de sus workspaces.

Un workspace borrado o una cuenta que ya no existe no rompe una página: da `null`
(`admin`, `workspaceName`) o se deja fuera, y los tipos lo dicen.

## Los módulos, conectados

`initialize-modules.ts` dice qué se le da al backoffice y entrega a cada módulo su parte:

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

  const staff = Staff_Module.initialize(base, { user: auth.user, access: auth.access }, { productId: PRODUCTS.backoffice })
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
  const user = User_Module.initialize(base, { staff, user: auth.user, access: auth.access, tenant: auth.tenant }, { workspacesProduct: WORKSPACES_PRODUCT })
  const workspace = Workspace_Module.initialize(base, { staff, tenant: auth.tenant, access: auth.access, user: auth.user, board: boards.board, card: boards.card })
  return { session, staff, user, workspace }
}

export type Backoffice_Modules = ReturnType<typeof initializeModules>
```

### `Backoffice_ModuleDeps`: un `Pick` de cada contexto

Al backoffice se le dan los **módulos** de auth y de boards, no los contextos. Un contexto
tiene una base, y una base tiene un store. Lo que puede tocar el backoffice está escrito en
su tipo de deps, como un `Pick` de los módulos de cada contexto. `openContexts` (más abajo)
pasa `auth.modules` entero, y TypeScript lo acepta donde se pide un `Pick`; pero dentro del
backoffice solo existen los módulos nombrados. No hay un `deps.auth.base.store` al que
llegar, y quien revisa ve de un vistazo de qué módulos de auth depende el backoffice.
Añadir uno es un cambio en este tipo, a la vista de todos.

### Iniciar sesión al personal

El personal inicia sesión con auth, como todo el mundo: el backoffice es un cliente OAuth
de auth, como boards. `WebSession_Module`, del [capítulo 22](./22-web-session), lo hace
todo; el backoffice solo rellena sus opciones:

- **`context: 'backoffice'`** nombra sus cookies: `cooper_backoffice_session`, no las de
  boards. Cada contexto tiene su puerto y, en producción, su dominio, así que sus sesiones
  son suyas.
- **`clientId: PRODUCTS.backoffice`** es el cliente que auth declaró para el producto
  `backoffice`, cuya URI de redirección es la URL pública del backoffice y el callback de
  la sesión web. `clientSecret` es su secreto, de `config.ts`.
- **`identify`** es el `token.verify` de auth, como en boards.
- **`profile`** es lo que responde `GET /api/session`, `{ user }` como lo lee toda app web.
  Aquí es `staff.me()`, que comprueba primero: alguien a quien le quitaron el acceso
  después de iniciar sesión recibe un 403 también de `/api/session`.

Quién puede iniciar sesión lo decide antes auth. El producto `backoffice` da acceso solo a
quien se le dijo (`access: 'granted'`, [capítulo 21](./21-oauth-server)), así que auth no
deja que nadie más diga que sí al backoffice: aprobar responde `oauthGrant.no_access`, un
403. Solo pueden volver atrás. Las rutas de la sesión web se registran en `base.http`,
fuera de `staffRoutes`: iniciar sesión debe funcionar antes de que se sepa que alguien es
del personal.

Así que hay dos comprobaciones, en dos momentos. auth rechaza al iniciar sesión a quien no
es del personal. `staff.enter` rechaza, en cada petición, a quien dejó de serlo después.

## El contexto

El contexto abre su store con sus migraciones, e inicializa sus módulos con lo que se le da:

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

Es un `ServedContext` ([capítulo 21](./21-oauth-server)): su propio servidor, su API bajo
`/api`, `/api/health`, y su frontend ya construido para cualquier otra dirección, cuando
haya uno. No sobrescribe ningún `routes()`: no tiene nada fuera de `/api`.

## Abrir tres contextos

`openContexts` abre el backoffice el último, después de los dos que lee. En
`open-contexts.ts`, impórtalo:

```ts
// cooper/backend/open-contexts.ts
import { Auth_Context } from './contexts/auth/auth.context'
import { WORKSPACES_PRODUCT } from './contexts/auth/modules/product/product.schema'
import { Backoffice_Context } from './contexts/backoffice/backoffice.context'
import { Boards_Context } from './contexts/boards/boards.context'
```

dilo en el comentario de la función, y ábrelo:

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
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, search: new MemoryCardSearch(), log: line => console.log(line) }, clock)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, clock)
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}
// …
```

`all` está en el orden en que se abren. `stopContexts` los detiene al revés, así que el
backoffice se detiene antes que los contextos que usa. `index.ts` sirve cada contexto de
`all`, así que el backoffice tiene su servidor, en el puerto 3003, sin una línea ahí.

A diferencia de boards, el backoffice no necesita un adaptador como `boardsOnAuth`. boards
pregunta a auth por puertos en sus propias palabras (`Workspaces`), porque las reglas de
boards dependen de ellos. El backoffice no tiene reglas propias sobre workspaces ni
cuentas; muestra las de auth y las de boards, así que toma sus módulos tal cual.

## El lint: backoffice usa auth y boards

Los archivos del backoffice importan los de auth y los de boards (sus clases de módulo, sus
esquemas, `PRODUCTS`). Dilo en `eslint.config.js`:

```js
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
```

`uses` sigue siendo un árbol: nadie usa el backoffice, así que auth y boards nunca pueden
importarlo. Sin el cambio, `newt/context-boundaries` rechaza todo import de auth o boards
desde la carpeta del backoffice, como rechazó los de boards en el [capítulo
20](./20-wiring-contexts).

Díselo también a los agentes de código: en `cooper/AGENTS.md`, añade el backoffice a
`## Contexts`, después de auth:

```md
- backoffice: what the staff see and do across the others. Uses auth and boards.
```

## Tests

### El backoffice para un test

El backoffice solo es interesante con datos reales en auth y boards. Sus tests abren los
tres contextos como lo hace el servidor, con cada base de datos en memoria, y crean los
datos con los casos de uso de auth y de boards, como lo haría cualquiera. Crea
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

- **`staffMember`** registra a alguien y lo admite en el backoffice con `access.admit`, que
  no comprueba ningún actor: igual que el seed crea al primer miembro del personal (el
  capítulo siguiente). Conceder exige ser del personal, y todavía no hay nadie.
- **`as`** ejecuta una llamada como alguien, como lo haría una petición.
- **`board`** crea un tablero con una columna y tarjetas, en un workspace, como uno de sus
  miembros.
- **`settled`** espera al trabajo en segundo plano en el orden en que fluye. Los jobs de
  auth se ejecutan primero (boards oye los eventos de auth: el tablero de bienvenida de un
  workspace nuevo), luego los de boards. Dos rondas, porque las reacciones de boards a los
  eventos de auth cuentan eventos propios.

### Los módulos

El personal: quién entra, conceder, quitar, y auth que comprueba otra vez:

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

El último test es el que importa para la regla de arriba. Ana no es del personal, y el
backoffice no le impide llamar a `staff.grant`. Se lo impide auth.

Las cuentas:

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

Los workspaces. Un workspace nuevo tiene un tablero de bienvenida con tarjetas
(`workspace.prepare`, [capítulo 14](./14-sagas)), así que los conteos se comparan con los
de boards, o se comprueba que sean al menos lo que creó el test:

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

### La API

El test de la API sustituye el autenticador de la sesión por una cabecera `x-user`, como
hacían los tests de boards antes de la sesión web, y pregunta a cada ruta como nadie, como
personal, y como alguien a quien acaban de quitar el acceso:

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

El segundo bucle es el sentido de `staffRoutes`: Ana inició sesión cuando era del personal,
y su sesión sigue siendo buena, pero todas las rutas la rechazan desde la petición
siguiente.

### Iniciar sesión

La otra mitad: iniciar sesión por auth, de extremo a extremo, por HTTP. auth y el
backoffice se sirven en puertos libres, y el `browser()` de newt, de `newt/testing`, sigue
redirecciones y guarda cookies por origen, como hace un navegador ([capítulo
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

Sam, del personal, inicia sesión y llega a `/staff`. Ana tiene cuenta pero ningún acceso:
auth responde a su aprobación con `oauthGrant.no_access`, solo puede denegar, y vuelve al
backoffice con `signInError` y sin sesión.

### Tres contextos en todas partes

Dos tests abren todos los contextos, y ahora son tres. En `open-contexts.test.ts`, el
backoffice recibe una base de datos en memoria y cualquier puerto:

```ts
// cooper/backend/open-contexts.test.ts
// …
    boards: { ...config.boards, database: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, database: ':memory:', port: 0 },
  }
}
// …
```

y el test espera tres de todo:

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

En `cooper.test.ts`, su comentario nombra los tres:

```ts
// cooper/backend/cooper.test.ts
// …
/**
 * cooper end to end: auth, boards and backoffice open as the server opens them, on
 * SQLite in memory, and boards used as its UI and an MCP client use it, over HTTP.
 */
// …
```

y su `testConfig` da al backoffice una base de datos en memoria, cualquier puerto, y el
auth del test:

```ts
// cooper/backend/cooper.test.ts
// …
    boards: { ...config.boards, database: ':memory:', port: boardsPort, publicUrl: boardsUrl, authPublicUrl: authUrl },
    backoffice: { ...config.backoffice, database: ':memory:', port: 0, authPublicUrl: authUrl },
  }
}
// …
```

Sin él, el test abriría el backoffice en el puerto 3003 y con su base de datos en archivo.

## Compruébalo

La comprobación:

```sh
bun install && bun check && bun test cooper && bun run lint && bun run cooper:build
```

Los tests del propio backoffice:

```sh
bun test cooper/backend/contexts/backoffice
```

```text
 13 pass
 0 fail
 59 expect() calls
Ran 13 tests across 5 files.
```

Arranca el servidor. Ahora sirve tres contextos:

```sh
bun cooper/backend/index.ts
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
backoffice listening on http://localhost:3003/
```

En otra terminal, el backoffice está en marcha, y su API pide a alguien con sesión:

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

Iniciar sesión envía al navegador a auth, como el cliente `backoffice`:

```sh
curl -i "localhost:3003/api/session/sign-in?returnTo=/"
```

```text
HTTP/1.1 302 Found
Location: http://localhost:5171/oauth/authorize?response_type=code&client_id=backoffice&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fsession%2Fcallback&code_challenge=…&code_challenge_method=S256&state=…
Set-Cookie: cooper_backoffice_sign_in=…; Path=/api/session; Max-Age=600; HttpOnly; SameSite=Lax
…
```

El resto del camino pasa por la página de inicio de sesión de auth, y todavía nadie es del
personal: el seed crea la primera cuenta del personal en el capítulo siguiente, con el
frontend del backoffice. Hasta entonces, `backoffice-sign-in.test.ts` lo recorre de
extremo a extremo.

## Qué recordar

- A un contexto que lee de otros se le dan **los casos de uso de sus módulos, como un
  `Pick`**: nunca una base, nunca un store. Su tipo de deps es la lista de aquello de lo
  que depende, a la vista de todos, y el `uses` del lint dice qué contextos puede importar.
- **Un grupo, una comprobación**: un grupo con prefijo `''` cuyo middleware ejecuta
  `staff.enter` pone la comprobación delante de cada ruta, y ninguna ruta puede olvidarla.
  Preguntar a auth en cada petición hace que un acceso quitado cuente al instante.
- **Compón las lecturas de página en página**: una página de uno para un total, `getMany` y
  `countBy…` para una página entera en una llamada, nunca una llamada por fila. Un contexto
  del que otros leen ofrece sus lecturas por lotes.
- **Escribir en otro contexto pasa por sus casos de uso**, que son su API: sus propias
  reglas se cumplen allí (auth vuelve a comprobar que quien llama es del personal). Haz que
  cada escritura así sea un guardado en un store.
- Una segunda app web inicia sesión por auth como la primera: **`WebSession_Module`, con su
  propio cliente y sus propias cookies**. auth rechaza al iniciar sesión a quien no tiene
  acceso; la comprobación de la propia app rechaza a quien lo perdió después.

Siguiente: [Jobs muertos y analítica](./26-dead-jobs-and-analytics).
