# Un segundo contexto: auth

Desde el capítulo [4](./04-who-and-where), `boards` le pregunta a un falso quién pertenece
a cada workspace, y cada petición dice quién la envía en una cabecera `x-user`. Cualquiera
podía ser cualquiera. cooper necesita cuentas: un email, un nombre y una contraseña, y una
forma de iniciar sesión que el navegador recuerde.

Nada de eso es asunto de boards. Quién es alguien sirve a todas las apps de cooper: los
tableros, más adelante el backoffice del personal, un asistente de IA por MCP. Así que
tiene un contexto propio, **`auth`**, con su propia base de datos, sus propios módulos y su
propio servidor, en el puerto 3001. No usa ningún otro contexto. Este capítulo construye
sus tres primeros módulos: los productos a los que da acceso, las cuentas y las sesiones
del propio auth. También ejecuta los dos contextos en un solo proceso, y ahí entra por fin
el manejo de señales que el capítulo [1](./01-project-and-context) dejó fuera.

boards todavía no usa auth. Sigue preguntando al falso, y conserva su cabecera `x-user`,
hasta que los capítulos [20](./20-wiring-contexts) y [22](./22-web-session) lo conecten a
auth.

Al final tendrás estos archivos:

```
eslint.config.js                 changed: auth is a context
cooper/backend/
  config.ts                      changed: auth's settings
  index.ts                       changed: runs every context with runContexts
  open-contexts.ts               opens the contexts in order
  open-contexts.test.ts
  shared/served-context.ts       changed: one comment
  contexts/boards/modules/card/card.workers.ts   changed: one comment
  contexts/auth/
    auth-base.ts  auth-config.ts  auth.context.ts  initialize-modules.ts  auth.test.ts
    migrations/sqlite/
      00001_user_up.sql  00001_user_down.sql
      00002_session_up.sql  00002_session_down.sql
    modules/
      product/   product.module.ts  product.schema.ts  product-options.ts
                 errors/product-not-found.ts
      user/      user.ts  user.schema.ts  user.repository.ts  user.module.ts
                 events/user-signed-up.ts  errors/{email-taken,user-not-found}.ts
      session/   session.ts  session.schema.ts  session.repository.ts  session.module.ts
                 session.routes.ts  session.deps.ts  session-options.ts
                 errors/{invalid-credentials,sign-up-closed}.ts
```

## Su configuración

auth escucha en el 3001 y guarda sus datos en su propio archivo SQLite. También necesita
saber dónde se abren las apps a las que da acceso, y cuánto dura una sesión. En
`config.ts`, añade `sessionDays` después de `env`, la URL pública del backoffice (su app
llega en el capítulo [25](./25-backoffice), pero auth la nombra desde ya) y la parte de
auth, antes de la de boards:

```ts
// cooper/backend/config.ts
const env = process.env

/** `COOPER_SESSION_DAYS`: how long a browser session lasts without signing in again, in every context. */
const sessionDays = Number(env.COOPER_SESSION_DAYS ?? 30)
// …
const publicUrls = {
  boards: env.COOPER_BOARDS_PUBLIC_URL ?? 'http://localhost:5172',
  backoffice: env.COOPER_BACKOFFICE_PUBLIC_URL ?? 'http://localhost:5173',
}
// …
  mail: {
    from: env.COOPER_MAIL_FROM ?? 'cooper <no-reply@cooper.local>',
  },
  /** Who someone is: accounts, and who is signed in, for every app of cooper. */
  auth: {
    /** `COOPER_AUTH_PORT`: where it listens. */
    port: Number(env.COOPER_AUTH_PORT ?? 3001),
    /** `COOPER_AUTH_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_AUTH_DATABASE ?? 'data/cooper-auth.db'),
    /** Where the other contexts are opened: the apps that sign people in through it. */
    boardsPublicUrl: publicUrls.boards,
    backofficePublicUrl: publicUrls.backoffice,
    sessionDays,
  },
  /** The SaaS: workspaces' boards, columns and cards. */
```

`sessionDays` está fuera de `auth` porque vale "en todos los contextos": el capítulo 22 le
da a boards una sesión de navegador propia, que dura lo mismo.

El tipo de la configuración del contexto es su parte de `Config`, como el de boards:

```ts
// cooper/backend/contexts/auth/auth-config.ts
import type { Config } from '../../config'

/** The settings of `auth`, from `config.ts`. */
export type Auth_Config = Config['auth']
```

## La base

Los módulos de auth reciben la base de cooper, como los de boards: el store, las
invocaciones, el bus, los jobs y el router. auth no necesita nada más por ahora, pero
tiene su propia clase desde el principio, para que sus módulos digan que son de auth:

```ts
// cooper/backend/contexts/auth/auth-base.ts
import { CooperBase } from '../../shared/cooper-base'

/**
 * What `auth`'s modules receive: cooper's base. For now nothing more: chapter 21 adds
 * a second router, for OAuth's addresses.
 */
export class AuthBase extends CooperBase {}
```

## El lint conoce un segundo contexto

Cada contexto vive en su propia carpeta bajo `contexts/`, y el ajuste `contexts` del lint
dice cuáles puede importar cada uno. auth no usa ninguno. Añádelo en `eslint.config.js`:

```js
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: [] } },
})
```

`uses` lista todos los contextos. Una carpeta que no aparece no usa ningún otro, así que
dejar fuera a auth lintaría igual hoy; dilo de todos modos, para que la forma de la
aplicación esté en un solo sitio. boards tampoco usa ninguno, por ahora: solo llega a auth
a través de puertos, y lo que recibe viene de quien lo abre. Cuando un archivo de un
contexto importa el de otro, `newt/context-boundaries` lo detiene. Pruébalo: importa
`BoardsBase` en `auth-base.ts`, y `bun run lint` dice

```text
error  '../boards/boards-base' is the context boards's, and auth uses no other context: contexts use only the ones they say, never in a cycle  newt/context-boundaries
```

Un `uses` que nombra un contexto que no existe, o un ciclo (auth usando boards mientras
boards usa auth), lanza un error en cuanto arranca el lint. Quita el import otra vez.

## Productos: un módulo sin entidad

auth da acceso a las apps de cooper, y tiene que conocerlas: sus nombres, dónde se abren,
y si alguien puede crear una cuenta de camino a una. Los tableros aceptan a cualquiera; el
backoffice, solo al personal que se le haya indicado.

Esas apps son piezas del sistema, no datos que alguien edite. Nadie añade un producto
desde un formulario: uno nuevo es código nuevo. Así que se declaran en código, y el módulo
de productos las guarda en memoria. Primero qué es un producto, y los ids que nombra el
resto del código:

```ts
// cooper/backend/contexts/auth/modules/product/product.schema.ts
import { z } from 'zod'

/**
 * The ids of cooper's products, which other contexts name when they ask auth about
 * them: `cooper` (the boards) and `backoffice` (the staff's console).
 */
export const PRODUCTS = { cooper: 'cooper', backoffice: 'backoffice' } as const

/** The product whose workspaces the tenants are: boards, the SaaS. */
export const WORKSPACES_PRODUCT = PRODUCTS.cooper

/**
 * An app of cooper that signs people in through auth, as cooper's code declares it:
 * `cooper` (the boards) and `backoffice` (the staff's console).
 */
export const ProductSchema = z.object({
  /** Its name in cooper's code. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** What people are shown when they sign in to it. */
  name: z.string().min(1),
  /** Where people open it. */
  publicUrl: z.url(),
  /** Whether someone without an account may make one on the way to it. */
  signUp: z.boolean(),
})

export type ProductDTO = z.infer<typeof ProductSchema>
```

`WORKSPACES_PRODUCT` es el producto cuyos tenants son los workspaces de boards. El
capítulo [13](./13-another-context) dejó `'cooper'` escrito en `card.workers.ts`,
esperando esta constante. Sigue siendo un literal un poco más: importarla desde boards
necesita el `boards: ['auth']` del lint, que llega en el capítulo 20. Cambia solo su
comentario allí:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
  // For now the product is named here: auth's WORKSPACES_PRODUCT (chapter 20) takes its place.
```

Al módulo se le dan sus productos como opción:

```ts
// cooper/backend/contexts/auth/modules/product/product-options.ts
import type { ProductDTO } from './product.schema'

export type Product_Options = {
  /** Every product, as cooper's code declares them: they are not data anyone edits. */
  products: ProductDTO[]
}
```

```ts
// cooper/backend/contexts/auth/modules/product/errors/product-not-found.ts
import { NotFoundError } from 'newt/core'

export class ProductNotFound extends NotFoundError {
  readonly code = 'product.not_found'
  constructor(id: string) {
    super(`There is no product ${id}`)
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/product/product.module.ts
import { Module, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { ProductNotFound } from './errors/product-not-found'
import type { Product_Options } from './product-options'
import { ProductSchema, type ProductDTO } from './product.schema'

/**
 * The apps that sign people in through auth. They are declared in cooper's code, not
 * kept in the store: a product is a piece of the system, not data anyone edits. So
 * this module has no entity and no repository, only what it was given.
 */
export class Product_Module extends Module {

  static initialize(base: AuthBase, options: Product_Options): Product_Module {
    return new Product_Module(base, options.products.map(product => ProductSchema.parse(product)))
  }

  private constructor(base: AuthBase, private readonly products: ProductDTO[]) {
    super('product', base.invocations)
  }

  /** For other modules and contexts: a product by its id. */
  @UseCase()
  async get(id: string): Promise<ProductDTO> {
    const product = this.products.find(each => each.id === id)
    if (!product) throw new ProductNotFound(id)
    return structuredClone(product)
  }
}
```

Un módulo es un conjunto de casos de uso, no una tabla. Este no tiene entidad ni
repositorio, y aun así es un módulo: su `get` es un caso de uso como cualquier otro, al
que llaman otros módulos, y que se ejecuta como tal. Comprueba cada producto con su
esquema al arrancar, así que un error de escritura en las declaraciones falla cuando se
abre el contexto, no cuando alguien inicia sesión. `get` entrega una copia
(`structuredClone`), para que ningún llamante pueda cambiar lo que guarda el módulo.

## Cuentas

El módulo de usuarios guarda las cuentas. Dos cosas lo distinguen de todos los módulos
hasta ahora: guarda un secreto, y una de sus reglas (un email pertenece a una sola
cuenta) trata de todas sus filas.

### Lo que ve cualquiera: el esquema

```ts
// cooper/backend/contexts/auth/modules/user/user.schema.ts
import { z } from 'zod'
import { Email } from 'newt/contract'

/** An account, as anyone sees it: never its password, nor its hash. */
export const UserSchema = z.object({
  id: z.uuidv7(),
  /** One account per email, whatever its case: kept in lower case. */
  email: Email.schema,
  name: z.string().trim().min(1, 'Write your name').max(80, 'Use at most 80 characters'),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** A password as it is chosen: long enough, never so long that hashing it is a cost. */
export const UserPasswordSchema = z.string().min(8, 'Use at least 8 characters').max(128, 'Use at most 128 characters')

/** A new account: the email as typed (it is kept in lower case), a name and a password. */
export const UserSignUpSchema = z.object({
  email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
  name: UserSchema.shape.name,
  password: UserPasswordSchema,
})

export type UserDTO = z.infer<typeof UserSchema>
export type UserSignUpDTO = z.input<typeof UserSignUpSchema>
```

- **`UserSchema` es la cuenta como la ve cualquiera**: un id, un email, un nombre, sus
  fechas. No tiene contraseña, ni su hash. Este archivo es el contrato del módulo, lo que
  ven otros módulos, contextos y frontends, así que un secreto no tiene sitio en él.
- **El email es el `Email` de newt**, que conociste en el capítulo 4: recortado y en
  minúsculas, con marca, así que un string normal no lo es hasta que pasó por `Email.from`
  o `Email.schema`. `Email.schema` acepta un email solo **como se guarda**: en minúsculas.
  Así "sea cual sea su capitalización" se convierte en una comparación simple:
  `Ana@Cooper.Test` y `ana@cooper.test` se guardan como el mismo string.
- **Lo que alguien escribe se acepta con holgura.** `UserSignUpSchema` toma el email tal
  como se escribió, con un `z.email()` normal: `Email.schema` rechazaría `Ana@Cooper.Test`
  por sus mayúsculas. La entidad lo pasa por `Email.from` antes de guardarlo. Los esquemas
  de entrada aceptan lo que escribe la gente; el esquema de la entidad, solo lo que se
  guarda.
- `UserPasswordSchema` admite una contraseña de entre 8 y 128 caracteres: lo bastante
  larga, nunca tanto que hashearla cueste al servidor.

### Lo que se guarda: la entidad, con un esquema público

```ts
// cooper/backend/contexts/auth/modules/user/user.ts
import { z } from 'zod'
import { Email, Entity, type EntityInput } from 'newt/core'
import { User_SignedUp } from './events/user-signed-up'
import { UserSchema } from './user.schema'

export * from './user.schema'

/** The account as it is kept: what anyone sees, and its password's hash. */
const UserEntitySchema = UserSchema.extend({
  /** `Bun.password`'s hash (argon2id): the password itself is never kept. */
  passwordHash: z.string().min(1),
})

export type UserEntityDTO = z.infer<typeof UserEntitySchema>

/** Someone with an account: who they are for every product of cooper. */
export class User extends Entity<typeof UserEntitySchema, typeof UserSchema> {

  private constructor(input: EntityInput<UserEntityDTO>, isNew: boolean) {
    super(UserEntitySchema, input, isNew, UserSchema)
  }

  static fromDTO(dto: UserEntityDTO & { version: number }): User {
    return new User(dto, false)
  }

  /** A new account, with its password already hashed: the email as someone typed it becomes an `Email`. */
  static signUp(input: { email: string, name: string, passwordHash: string }): User {
    const user = new User({ ...input, email: Email.from(input.email) }, true)
    user.trackEvent(new User_SignedUp(user.toDTO()))
    return user
  }

  get email(): Email {
    return this.data.email
  }

  get passwordHash(): string {
    return this.data.passwordHash
  }
}
```

La cuenta se guarda con el hash de su contraseña, que nunca debe salir de auth. Así que la
entidad tiene **dos esquemas**:

- **`UserEntitySchema`**, todo lo que guarda: `UserSchema` ampliado con `passwordHash`. Es
  el primer argumento de `Entity` y de `super`.
- **`UserSchema`**, su **esquema público**: lo que ve cualquier otro. Es el segundo
  argumento de tipo, `Entity<typeof UserEntitySchema, typeof UserSchema>`, y el último
  argumento de `super`.

Con un esquema público, `toDTO()` da solo sus campos, y el repositorio sigue guardándolos
todos. Toda salida del módulo pasa por `toDTO()`: lo que devuelve un caso de uso, lo que
responde una ruta, y el evento que `signUp` registra, `new User_SignedUp(user.toDTO())`.
Así el hash nunca llega a un evento, a un job del outbox, a una línea de log ni a una
respuesta, sin que nadie tenga que acordarse de dejarlo fuera.

newt te lo exige en las dos direcciones. El esquema de la entidad debe tener todos los
campos del público: un esquema público con un campo que la entidad no guarda lanza un
error al construir la entidad. Y cuando el segundo argumento de tipo difiere del primero,
el último argumento del constructor es obligatorio: una entidad que dice tener un esquema
público y no lo pasa no compila.

La entidad usa el hash en un solo sitio, `get passwordHash()`, que el módulo lee para
comprobar una contraseña. Un getter no es un dato: `toDTO()` no lo ve.

`User.signUp` recibe la contraseña ya hasheada. Hashear es lento a propósito, y `async`;
los métodos de una entidad no son ni lo uno ni lo otro. El módulo hashea, la entidad
guarda.

Su evento y sus errores:

```ts
// cooper/backend/contexts/auth/modules/user/events/user-signed-up.ts
import { now, type DomainEvent } from 'newt/core'
import type { UserDTO } from '../user.schema'

/** Someone made an account: who they are, never their password. */
export class User_SignedUp implements DomainEvent<UserDTO> {
  static readonly eventName = 'user.signedUp'
  readonly name = User_SignedUp.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: UserDTO) {}
}
```

```ts
// cooper/backend/contexts/auth/modules/user/errors/email-taken.ts
import { ConflictError } from 'newt/core'

/** Another account has this email, whatever its case. */
export class EmailTaken extends ConflictError {
  readonly code = 'user.email_taken'
  constructor() {
    super('There is an account with this email already: sign in instead')
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/user/errors/user-not-found.ts
import { NotFoundError } from 'newt/core'

export class UserNotFound extends NotFoundError {
  readonly code = 'user.not_found'
  constructor(id: string) {
    super(`There is no user ${id}`)
  }
}
```

Su `occurredAt` es `now()`, como en los eventos de boards desde el [capítulo 10](./10-events):
la hora según el reloj del contexto. auth aún no tiene reloj propio, así que es la hora
real; el [capítulo 19](./19-invitations-and-time) le da uno, y sus eventos lo siguen.

`EmailTaken` es un `ConflictError`, un 409, como `BoardNameTaken`.

### Una cuenta por email: el repositorio

```ts
// cooper/backend/contexts/auth/modules/user/user.repository.ts
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { EmailTaken } from './errors/email-taken'
import { User, type UserEntityDTO } from './user'

/** An account as its table keeps it: the email comes back as an `Email`. */
export type UserRow = UserEntityDTO & { version: number }

export class User_Repository extends TableRepository<User, UserRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<UserRow>('user'))
  }

  protected toEntity(row: UserRow): User {
    return User.fromDTO(row)
  }

  /**
   * Saves an account only if no other one has its email: checked after the write, in
   * its transaction, guarding that email, so two people signing up with it at once
   * cannot both get it. Emails are kept in lower case, so this is whatever the case
   * they were typed in. Any store keeps this rule the same way, with no unique index.
   */
  async persistWithEmailFree(user: User): Promise<void> {
    await this.save([user], each => this.write(each), {
      guard: [`userEmail:${user.email}`],
      after: async () => {
        if (await this.count({ email: user.email }) > 1) throw new EmailTaken()
      },
    })
  }
}
```

Es otra vez el nombre de tablero del capítulo [6](./06-rules-over-rows): una regla sobre
filas, comprobada en el guardado. `persistWithEmailFree` escribe la cuenta y, en la misma
transacción, cuenta las cuentas con su email, y lanza `EmailTaken` si hay dos. El guardado
se deshace, y no se guarda nada.

El `guard` es el propio email, `userEmail:<email>`: dos registros con el mismo email se
turnan, en cualquier store, mientras que los registros con emails distintos no se esperan
entre sí. Como el email se guarda en minúsculas, `ANA@cooper.test` y `ana@cooper.test`
comparten la clave y el recuento encuentra las dos.

Los nombres de tablero tenían también un índice único, como última palabra. El email no lo
tiene, a propósito: el índice de la tabla sobre `email` (más abajo) solo hace rápida la
búsqueda. La comprobación en el guardado basta, y se cumple igual en SQLite, en Postgres o
en cualquier store que escribas, que es lo que dice el comentario. (El capítulo
[18](./18-tenants-and-access) muestra el otro camino, un índice único cuyo
`DuplicateValue` el módulo convierte en un error propio.)

### Los casos de uso

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
import { Email, eventsOf, Module, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { EmailTaken } from './errors/email-taken'
import { UserNotFound } from './errors/user-not-found'
import { User_SignedUp } from './events/user-signed-up'
import { User, UserSignUpSchema, type UserDTO, type UserSignUpDTO } from './user'
import { User_Repository } from './user.repository'

/**
 * A hash to check a password against when there is no account: signing in with an
 * unknown email takes as long as with a wrong password, so the time says nothing.
 */
const NOBODY = await Bun.password.hash('nobody has this password')

/** The accounts: who someone is, for every product of cooper. */
export class User_Module extends Module {

  static initialize(base: AuthBase): User_Module {
    return new User_Module(base, new User_Repository(base))
  }

  readonly events

  private constructor(base: AuthBase, private readonly repo: User_Repository) {
    super('user', base.invocations)
    this.events = eventsOf(base.bus, { signedUp: User_SignedUp })
  }

  /** A new account. `session.signUp` signs it in at once. */
  @UseCase()
  async signUp(input: UserSignUpDTO): Promise<UserDTO> {
    const { email, name, password } = UserSignUpSchema.parse(input)
    const user = User.signUp({ email, name, passwordHash: await Bun.password.hash(password) })
    // For a clear answer in the usual case: the save checks it again, where nothing slips in between.
    if (await this.repo.count({ email: user.email }) > 0) throw new EmailTaken()
    await this.repo.persistWithEmailFree(user)
    return user.toDTO()
  }

  /** The account of this email if the password is its own; null otherwise, as slowly either way. */
  @UseCase()
  async verifyPassword(email: string, password: string): Promise<UserDTO | null> {
    const parsed = Email.schema.safeParse(email.trim().toLowerCase())
    const user = parsed.success ? await this.repo.first({ email: parsed.data }) : undefined
    const matches = await Bun.password.verify(password, user?.passwordHash ?? NOBODY)
    return user && matches ? user.toDTO() : null
  }

  @UseCase()
  async get(id: string): Promise<UserDTO> {
    return (await this.resolve(() => this.repo.find({ id }), () => new UserNotFound(id))).toDTO()
  }
}
```

- **`signUp`** valida la entrada, hashea la contraseña con `Bun.password.hash` (argon2id,
  con sal, y sus parámetros dentro del hash) y construye la cuenta. Luego los dos pasos de
  siempre: primero un `count`, para dar una respuesta clara en el caso habitual; después
  `persistWithEmailFree`, que lo comprueba otra vez donde nada se cuela por medio.
  Devuelve `user.toDTO()`: sin hash.
- **`verifyPassword`** es cómo se comprueba una contraseña, y no le dice nada a quien lo
  intenta. Un email desconocido y una contraseña incorrecta dan ambos `null`. También
  tardan lo mismo: sin cuenta, `Bun.password.verify` se ejecuta igualmente, contra
  `NOBODY`, un hash hecho una sola vez cuando se carga el módulo. Sin él, un email
  desconocido respondería al instante y uno conocido tras un hash lento, y solo el tiempo
  diría qué emails tienen cuenta. El email se pasa a minúsculas y se comprueba con
  `Email.schema`, así que `ANA@cooper.test` encuentra a Ana, y algo que no es un email no
  encuentra a nadie.
- **`get`**, para otros módulos: una cuenta por su id, o `UserNotFound`.

El módulo de usuarios no tiene rutas. La gente llega a él a través del módulo de sesiones,
que los hace iniciar sesión al registrarse.

### Su tabla

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00001_user_up.sql
-- The accounts. An email belongs to one account: the user module checks it after each
-- save, in its transaction (a rule over rows any store can keep), so this index only
-- finds an account by its email quickly. Emails are kept in lower case.
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX user_email ON "user" (email);
```

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00001_user_down.sql
DROP TABLE "user";
```

Las migraciones de auth son suyas, numeradas desde `00001` en su propia carpeta: cada
contexto tiene su propia base de datos, y la actualiza él mismo al abrirse. `user` es una
palabra que SQL se reserva, así que su nombre va siempre entre comillas.

## Sesiones

Cuando alguien se registra o inicia sesión, hay que decirle al navegador que es esa
persona en cada petición siguiente. auth le entrega un **token** en una cookie, y guarda
la sesión: de quién es y hasta cuándo.

### Un token, y solo su hash

Un token es una llave: quien la tiene ha iniciado sesión. El **`SecretToken`** de newt, de
`newt/core`, es uno: 32 bytes aleatorios en base64url, de `SecretToken.generate()`. Como
`Email`, tiene marca: un string que viene de una cookie es un `SecretToken` solo cuando
`SecretToken.schema` o `SecretToken.from` lo han comprobado. El store nunca guarda el
token, solo `SecretToken.hash(token)`, un SHA-256: una copia de la base de datos, una
copia de seguridad o una filtración no abren nada. Y como el token es aleatorio y largo,
basta un hash rápido; una contraseña necesita uno lento porque la gente las elige cortas.

```ts
// cooper/backend/contexts/auth/modules/session/session.ts
import { z } from 'zod'
import { Entity, SecretToken, type EntityInput } from 'newt/core'

/** Not part of the contract: a session is only ever seen as "who is signed in". */
const SessionEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  tokenHash: z.string().min(1),
  expiresAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type SessionEntityDTO = z.infer<typeof SessionEntitySchema>

/** A browser signed in to auth. The browser holds the token; the store only its hash. */
export class Session extends Entity<typeof SessionEntitySchema> {

  private constructor(input: EntityInput<SessionEntityDTO>, isNew: boolean) {
    super(SessionEntitySchema, input, isNew)
  }

  static fromDTO(dto: SessionEntityDTO & { version: number }): Session {
    return new Session(dto, false)
  }

  /** A new session for `userId`, and the token only its browser will hold. */
  static open(userId: string, days: number): { session: Session, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
    return { session: new Session({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }

  get userId(): string {
    return this.data.userId
  }

  isExpired(at = new Date()): boolean {
    return new Date(this.data.expiresAt) <= at
  }

  /** Signed out, or expired: a session is not history, its row goes. */
  close(): void {
    this.markAsDeleted()
  }
}
```

- **Su esquema vive aquí, no en `session.schema.ts`.** Nadie más ve una sesión; lo que ven
  los demás es "quién ha iniciado sesión", una cuenta. Así que no forma parte del
  contrato del módulo, y no necesita esquema público: ningún DTO suyo sale del módulo.
- **`Session.open`** crea el token, guarda su hash en una sesión nueva, y devuelve ambos:
  la sesión para el store, el token para el navegador. El servidor no guarda copia: desde
  ese momento solo ve el token cuando el navegador lo devuelve.
- **`close`** es `markAsDeleted()`. Su repositorio no es de borrado lógico, así que
  guardarla borra la fila: una sesión cerrada no es historia.
- Lee la hora con `Date.now()` y `new Date()` por ahora. El capítulo
  [19](./19-invitations-and-time) da a cada contexto un reloj que los tests pueden mover.

```ts
// cooper/backend/contexts/auth/modules/session/session.repository.ts
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Session, type SessionEntityDTO } from './session'

export type SessionRow = SessionEntityDTO & { version: number }

export class Session_Repository extends TableRepository<Session, SessionRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<SessionRow>('session'))
  }

  protected toEntity(row: SessionRow): Session {
    return Session.fromDTO(row)
  }
}
```

```sql
-- cooper/backend/contexts/auth/migrations/sqlite/00002_session_up.sql
-- Who is signed in to auth itself, browser by browser. Only the hash of each token:
-- a copy of the database opens nothing.
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
-- cooper/backend/contexts/auth/migrations/sqlite/00002_session_down.sql
DROP TABLE session;
```

`token_hash` es `UNIQUE`: así se encuentra una sesión, y dos tokens aleatorios nunca
comparten hash.

### Lo que recibe

```ts
// cooper/backend/contexts/auth/modules/session/session.schema.ts
import { z } from 'zod'
import { UserSignUpSchema } from '../user/user.schema'

/**
 * The cookie of a session of auth. Named after auth, not `session`: on one host in
 * development (localhost, whatever the port) the cookies of every context meet.
 */
export const SessionCookie = 'cooper_auth_session'

/** A new account, signed in at once; on the way to a product, the product it is for. */
export const SessionSignUpSchema = UserSignUpSchema.extend({
  /** The product that sent the person here: only one that takes new accounts makes one. */
  productId: z.string().optional(),
})

export const SessionSignInSchema = z.object({
  email: z.string().trim().min(1, 'Write your email'),
  password: z.string().min(1, 'Write your password'),
})

export type SessionSignUpDTO = z.input<typeof SessionSignUpSchema>
export type SessionSignInDTO = z.infer<typeof SessionSignInSchema>
```

- **El nombre de la cookie** dice que es de auth. Los navegadores guardan las cookies por
  host, no por puerto, así que en desarrollo todos los contextos en `localhost` las
  comparten. Cuando boards tenga una cookie de sesión propia (capítulo 22), las dos no
  deben llamarse igual.
- **`SessionSignUpSchema`** es el esquema de registro de usuarios con un campo más: el
  producto que envió a la persona aquí, si lo hay.

Sus errores, sus opciones y lo que usa:

```ts
// cooper/backend/contexts/auth/modules/session/errors/invalid-credentials.ts
import { UnauthorizedError } from 'newt/core'

/** The same answer for an unknown email and a wrong password: it tells nobody which accounts exist. */
export class InvalidCredentials extends UnauthorizedError {
  readonly code = 'session.invalid_credentials'
  constructor() {
    super('The email and the password do not match')
  }
}
```

```ts
// cooper/backend/contexts/auth/modules/session/errors/sign-up-closed.ts
import { ForbiddenError } from 'newt/core'

/** The product someone is on the way to lets in only whom it was told: no account is made for it. */
export class SignUpClosed extends ForbiddenError {
  readonly code = 'session.sign_up_closed'
  constructor(productName: string) {
    super(`${productName} does not take new accounts: ask someone who runs it for access`)
  }
}
```

`InvalidCredentials` es un `UnauthorizedError`, un 401, y dice lo mismo si el email no
tiene cuenta o si la contraseña es incorrecta. `SignUpClosed` es un 403.

```ts
// cooper/backend/contexts/auth/modules/session/session-options.ts
export type Session_Options = {
  /** How long a session lasts without signing in again. */
  days: number
}
```

```ts
// cooper/backend/contexts/auth/modules/session/session.deps.ts
import type { Product_Module } from '../product/product.module'
import type { User_Module } from '../user/user.module'

export interface Session_Deps {
  user: User_Module
  product: Product_Module
}
```

### Las rutas, públicas, y la cookie

```ts
// cooper/backend/contexts/auth/modules/session/session.routes.ts
import type { BunRequest } from 'bun'
import type { AuthBase } from '../../auth-base'
import type { Session_Module } from './session.module'
import { SessionCookie, type SessionSignInDTO, type SessionSignUpDTO } from './session.schema'

export function registerSessionRoutes(base: AuthBase, sessions: Session_Module): void {
  /** The session lives in a cookie the page's scripts cannot read, sent only to auth. */
  const keep = (request: BunRequest, token: string) => request.cookies.set(SessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessions.options.days * 24 * 60 * 60,
    secure: new URL(request.url).protocol === 'https:',
  })

  // The use cases validate every body.
  base.http.post('/session/sign-up', async request => {
    const { user, token } = await sessions.signUp((await request.json()) as SessionSignUpDTO)
    keep(request, token)
    return Response.json(user, { status: 201 })
  }, { public: true })

  base.http.post('/session/sign-in', async request => {
    const { user, token } = await sessions.signIn((await request.json()) as SessionSignInDTO)
    keep(request, token)
    return Response.json(user)
  }, { public: true })

  // Public: signing out with a session already gone still clears the cookie.
  base.http.post('/session/sign-out', async request => {
    await sessions.signOut(request.cookies.get(SessionCookie) ?? undefined)
    request.cookies.delete({ name: SessionCookie, path: '/' })
    return new Response(null, { status: 204 })
  }, { public: true })

  base.http.get('/session', async () => Response.json(await sessions.me()))
}
```

Toda ruta necesita a alguien con la sesión iniciada (capítulo [2](./02-first-module)), y
nadie ha iniciado sesión antes de registrarse o de entrar. Así que esas rutas dicen
**`{ public: true }`**: el router las ejecuta sin preguntar al autenticador, sin actor. Una
ruta pública no debe llegar a un caso de uso que pida `currentActor()`; estas tres no lo
hacen.

Cerrar sesión también es público. Alguien cuya sesión ya caducó, o se cerró desde otra
pestaña, debería poder borrar igualmente su cookie, no recibir un 401.

`GET /session`, quién ha iniciado sesión, no es público: sin sesión, el router responde
un 401, `not_signed_in`, antes de ejecutar la ruta.

`keep` pone la cookie con el `request.cookies` de Bun, que la respuesta lleva de vuelta
como `Set-Cookie`:

- **`httpOnly`**: los scripts de la página no pueden leerla. Un script inyectado en una
  página no puede robar la sesión.
- **`sameSite: 'lax'`**: la página de otro sitio no puede hacer que el navegador la envíe
  con un formulario que ella publique.
- **`maxAge`**: tan largo como la sesión, así que el navegador la olvida cuando la olvida
  auth.
- **`secure`** cuando la petición llegó por https: en producción nunca se envía en claro;
  en desarrollo, en `http://localhost`, sigue funcionando.

Las rutas leen el cuerpo como JSON y lo pasan: los casos de uso validan todo.

### Los casos de uso

```ts
// cooper/backend/contexts/auth/modules/session/session.module.ts
import { currentActor, Module, SecretToken, UseCase, type Actor } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import type { UserDTO } from '../user/user.schema'
import { InvalidCredentials } from './errors/invalid-credentials'
import { SignUpClosed } from './errors/sign-up-closed'
import { Session } from './session'
import type { Session_Deps } from './session.deps'
import type { Session_Options } from './session-options'
import { Session_Repository } from './session.repository'
import { registerSessionRoutes } from './session.routes'
import { SessionCookie, SessionSignInSchema, SessionSignUpSchema, type SessionSignInDTO, type SessionSignUpDTO } from './session.schema'

/**
 * Who is signed in to auth itself: signing up, in and out, and who sends each request
 * to auth's API.
 */
export class Session_Module extends Module {

  static initialize(base: AuthBase, deps: Session_Deps, options: Session_Options): Session_Module {
    const module = new Session_Module(base, new Session_Repository(base), deps, options)
    base.http.authenticateWith(request => module.authenticate(request.cookies.get(SessionCookie) ?? undefined))
    registerSessionRoutes(base, module)
    return module
  }

  private constructor(
    base: AuthBase,
    private readonly repo: Session_Repository,
    private readonly deps: Session_Deps,
    readonly options: Session_Options,
  ) {
    super('session', base.invocations)
  }

  /**
   * A new account, signed in at once; on the way to a product, only if it takes new
   * accounts. It writes to `user` without being a worker, on purpose: the person waits
   * for their account and their session in one answer. The account is saved first; if
   * opening the session fails, the account stays, and the person signs in.
   */
  @UseCase({ writesTo: ['user'] })
  async signUp(input: SessionSignUpDTO): Promise<{ user: UserDTO, token: SecretToken }> {
    const { productId, ...account } = SessionSignUpSchema.parse(input)
    if (productId !== undefined) {
      const product = await this.deps.product.get(productId)
      if (!product.signUp) throw new SignUpClosed(product.name)
    }

    const user = await this.deps.user.signUp(account)
    return { user, token: await this.open(user.id) }
  }

  @UseCase()
  async signIn(input: SessionSignInDTO): Promise<{ user: UserDTO, token: SecretToken }> {
    const { email, password } = SessionSignInSchema.parse(input)
    const user = await this.deps.user.verifyPassword(email, password)
    if (!user) throw new InvalidCredentials()
    return { user, token: await this.open(user.id) }
  }

  /** Ends the session of this token, if it is one: signing out twice is signing out once. */
  @UseCase()
  async signOut(token: string | undefined): Promise<void> {
    const session = await this.find(token)
    if (!session) return
    session.close()
    await this.repo.persist(session)
  }

  /** The signed-in person. */
  @UseCase()
  async me(): Promise<UserDTO> {
    return this.deps.user.get(currentActor().userId)
  }

  /** Who sent a request, from its cookie's token. An expired session is closed. */
  @UseCase()
  async authenticate(token: string | undefined): Promise<Actor | null> {
    const session = await this.find(token)
    if (!session) return null
    if (session.isExpired()) {
      session.close()
      await this.repo.persist(session)
      return null
    }
    return { userId: session.userId, via: 'web' }
  }

  private async find(token: string | undefined): Promise<Session | undefined> {
    const parsed = SecretToken.schema.safeParse(token)
    return parsed.success ? this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
  }

  private async open(userId: string): Promise<SecretToken> {
    const { session, token } = Session.open(userId, this.options.days)
    await this.repo.persist(session)
    return token
  }
}
```

**`initialize` fija el autenticador de auth.** En boards, `index.ts` decía quién envía cada
petición. En auth lo sabe el módulo de sesiones: él mismo registra
`base.http.authenticateWith(...)`, que lleva el token de la cookie a `authenticate`. Quien
abra auth recibe un router que ya conoce sus sesiones, en el servidor y en todos los
tests.

- **`signUp`** comprueba primero el producto, si lo hay: `cooper` acepta cuentas nuevas,
  `backoffice` no, y responde `SignUpClosed` antes de crear ninguna cuenta. Sin producto
  (alguien que llegó directamente a auth) cualquiera puede registrarse. Luego hace que el
  módulo de usuarios cree la cuenta, y abre una sesión para ella.
- **`signIn`** pregunta a `verifyPassword`, y responde `InvalidCredentials` ante `null`,
  sea cual sea el motivo.
- **`signOut`** cierra la sesión del token, si lo es. Un token que no encuentra ninguna
  sesión (ya cerrada, o que nunca lo fue) no hace nada: cerrar sesión dos veces es cerrar
  sesión una.
- **`me`** es la cuenta de quien actúa, `currentActor().userId`, que el router fijó a
  partir de la cookie.
- **`authenticate`** encuentra la sesión por el hash de su token, y devuelve el actor,
  `{ userId, via: 'web' }`, o `null`. Una sesión caducada se cierra al encontrarla, así
  que la próxima vez no hay nada que encontrar.
- **`find`** comprueba la forma del token con `SecretToken.schema.safeParse` antes de
  hashearlo: una cookie es lo que el navegador haya enviado, y algo que no es un token no
  es una sesión, no un error.

### Escribir en otro módulo: `writesTo`, dentro de un contexto

`session.signUp` guarda dos veces: la cuenta, a través de `user.signUp`, y la sesión, en
su propio módulo. Eso es una escritura en otro módulo fuera de un worker, que la regla de
escritura rechaza (capítulo [8](./08-two-people-one-card)): ejecútalo sin `writesTo` y
lanza `[write rule] session.signUp writes to auth.user outside a worker`.

El otro camino sería el habitual: el módulo de usuarios cuenta `user.signedUp`, y un
worker abre la sesión. Pero una sesión abierta un momento después no le sirve a quien
espera la respuesta de su registro, con una cookie dentro. Así que escribe directamente, y
lo dice: `@UseCase({ writesTo: ['user'] })`, con el motivo en el comentario.

Mira qué deja un fallo. La cuenta se guarda primero, en su propia transacción. Si luego
falla abrir la sesión, la cuenta se queda, y la persona inicia sesión. Nada queda a medias:
una cuenta sin sesión es una cuenta normal. Eso es lo que hace aceptable la excepción,
como lo fue en `removeColumn`, cuya única escritura era la de la columna.

La regla es por contexto. `writesTo: ['user']` nombra un módulo de auth, el mismo en que
está este caso de uso. Un caso de uso de otro contexto que llama a los de auth es otra
historia, que cuenta el capítulo 20.

## El contexto

La lista de los módulos de auth, cada uno después de los que usa. `declaredProducts` son
los productos de cooper, con sus URL públicas de la configuración:

```ts
// cooper/backend/contexts/auth/initialize-modules.ts
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Auth_Config } from './auth-config'
import type { AuthBase } from './auth-base'
import { Product_Module } from './modules/product/product.module'
import { PRODUCTS, WORKSPACES_PRODUCT, type ProductDTO } from './modules/product/product.schema'
import { Session_Module } from './modules/session/session.module'
import { User_Module } from './modules/user/user.module'

/** cooper's products, declared here: the apps that sign people in through auth. */
export function declaredProducts(config: Auth_Config): ProductDTO[] {
  return [
    {
      id: WORKSPACES_PRODUCT,
      name: 'Cooper',
      publicUrl: config.boardsPublicUrl,
      signUp: true,
    },
    {
      id: PRODUCTS.backoffice,
      name: 'Cooper Backoffice',
      publicUrl: config.backofficePublicUrl,
      signUp: false,
    },
  ]
}

/** Every module of `auth`, each one after the modules it uses. */
export function initializeModules(base: AuthBase, config: Auth_Config) {
  const product = Product_Module.initialize(base, { products: declaredProducts(config) })
  const user = User_Module.initialize(base)
  const session = Session_Module.initialize(base, { user, product }, { days: config.sessionDays })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { product, user, session, outbox }
}

export type Auth_Modules = ReturnType<typeof initializeModules>
```

El módulo outbox del capítulo [12](./12-failures) también está aquí: los jobs muertos de
auth, sobre el store propio de auth. auth no crea jobs todavía, pero cada contexto tiene
uno desde el principio.

```ts
// cooper/backend/contexts/auth/auth.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { ServedContext } from '../../shared/served-context'
import { AuthBase } from './auth-base'
import type { Auth_Config } from './auth-config'
import { initializeModules, type Auth_Modules } from './initialize-modules'

/**
 * Who someone is: accounts, and who is signed in, for every app of cooper. It uses no
 * other context.
 */
export class Auth_Context extends ServedContext {

  private constructor(auth: AuthBase, readonly modules: Auth_Modules, readonly config: Auth_Config) {
    super('auth', auth, config)
  }

  /** Opening it brings its database up to date before any module reads it. */
  static async open(config: Auth_Config): Promise<Auth_Context> {
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new AuthBase({ name: 'auth', store })
    const modules = initializeModules(base, config)
    return new Auth_Context(base, modules, config)
  }
}
```

Es otra vez el contexto de boards, con su propio nombre, su propio archivo de base de
datos y su propia carpeta de migraciones. Cada contexto abre su propio store: las cuentas
de auth y las tarjetas de boards nunca comparten una transacción, y uno podría pasar a
otra base de datos sin que el otro lo note.

## Sus tests

Los tests de auth abren el contexto real, sobre una base de datos en memoria:

```ts
// cooper/backend/contexts/auth/auth.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Auth_Context } from './auth.context'

let auth: Auth_Context

beforeEach(async () => {
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port: 0 })
  auth.start()
})

afterEach(() => auth.stop())

const modules = () => auth.modules
const signUp = (name: string, email = `${name.toLowerCase()}@cooper.test`) => modules().user.signUp({ email, name, password: 'a long password' })

describe('accounts', () => {
  test('signs up with an email no other account has, whatever its case', async () => {
    const ana = await signUp('Ana', ' Ana@Cooper.Test ')
    expect(ana).toMatchObject({ email: 'ana@cooper.test', name: 'Ana' })
    expect(ana).not.toHaveProperty('passwordHash')

    await expect(signUp('Other Ana', 'ANA@cooper.test')).rejects.toMatchObject({ code: 'user.email_taken' })
    const atOnce = await Promise.allSettled([signUp('Bob', 'bob@cooper.test'), signUp('Bob', 'BOB@cooper.test')])
    expect(atOnce.map(each => each.status).sort()).toEqual(['fulfilled', 'rejected'])
  })

  test('checks a password, and says nothing about which emails have an account', async () => {
    await signUp('Ana')
    expect(await modules().user.verifyPassword('ANA@cooper.test', 'a long password')).toMatchObject({ name: 'Ana' })
    expect(await modules().user.verifyPassword('ana@cooper.test', 'wrong')).toBeNull()
    expect(await modules().user.verifyPassword('nobody@cooper.test', 'a long password')).toBeNull()
    await expect(modules().session.signIn({ email: 'nobody@cooper.test', password: 'x' })).rejects.toMatchObject({ code: 'session.invalid_credentials' })
  })

  test('opens a session at sign-up, unless the product takes no new accounts', async () => {
    const { user, token } = await modules().session.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password', productId: 'cooper' })
    expect(await modules().session.authenticate(token)).toEqual({ userId: user.id, via: 'web' })

    await expect(modules().session.signUp({ email: 'bob@cooper.test', name: 'Bob', password: 'a long password', productId: 'backoffice' })).rejects.toMatchObject({ code: 'session.sign_up_closed' })
    await modules().session.signOut(token)
    expect(await modules().session.authenticate(token)).toBeNull()
  })

  test('signs up, in and out through its API, the session in a cookie only auth reads', async () => {
    const server = serve(auth.serving())
    try {
      const call = (method: string, path: string, body?: unknown, cookie = '') => fetch(new URL(`/api${path}`, server.url), {
        method,
        headers: { 'content-type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const signedUp = await call('POST', '/session/sign-up', { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })
      expect(signedUp.status).toBe(201)
      expect(signedUp.headers.get('set-cookie')).toContain('HttpOnly')
      const cookie = signedUp.headers.get('set-cookie')!.split(';')[0]!
      expect(await (await call('GET', '/session', undefined, cookie)).json()).toMatchObject({ name: 'Ana', email: 'ana@cooper.test' })
      expect((await call('GET', '/session')).status).toBe(401)

      expect((await call('POST', '/session/sign-in', { email: 'ana@cooper.test', password: 'wrong' })).status).toBe(401)
      expect((await call('POST', '/session/sign-out', undefined, cookie)).status).toBe(204)
      expect((await call('GET', '/session', undefined, cookie)).status).toBe(401)
    } finally {
      await server.stop()
    }
  })
})
```

- **El primero** registra a Ana con ` Ana@Cooper.Test `, recibe `ana@cooper.test`, y
  ningún `passwordHash`. Otra cuenta con `ANA@cooper.test` está tomada. Dos registros de
  Bob en el mismo momento, con dos capitalizaciones: uno gana, otro falla.
- **El segundo** comprueba la contraseña, con cualquier capitalización del email, y que
  una contraseña incorrecta y un email desconocido se ven igual.
- **El tercero** abre una sesión al registrarse, autentica su token, rechaza un registro
  en el backoffice, y cierra sesión: el token no abre nada después.
- **El último** pasa por HTTP: sirve el contexto en un puerto libre, se registra y recibe
  una cookie marcada `HttpOnly`, la devuelve a `GET /session`, recibe un 401 sin ella, y
  cierra sesión.

## Todos los contextos en un proceso

cooper tiene ahora dos contextos, y su backend los ejecuta a ambos. Abrirlos es una sola
función, así que el servidor, los tests y más adelante los scripts los abren de la misma
forma:

```ts
// cooper/backend/open-contexts.ts
import type { Config } from './config'
import { Auth_Context } from './contexts/auth/auth.context'
import { Boards_Context } from './contexts/boards/boards.context'
import { MemoryCardSearch } from './contexts/boards/search/memory-card-search'
import { FakeAuth } from './contexts/boards/testing/fake-auth'
import { ConsoleMailer } from './shared/mail/console-mailer'
import type { Mailer } from './shared/mail/mailer'

/** What the contexts are given from outside: the console mailer unless another is. */
export type OpenContextsOptions = {
  mailer?: Mailer
}

/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`. The server opens them.
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  const auth = await Auth_Context.open(config.auth)
  // For now boards asks a fake auth, in memory: ana and carl are in acme, bea in globex (chapter 20 wires it to auth).
  const fake = await FakeAuth.open()
  fake.join('acme', 'ana')
  fake.join('acme', 'carl')
  fake.join('globex', 'bea')
  // For now each card's move is a line on the console (chapter 28 writes it only while tracing).
  const boards = await Boards_Context.open(config.boards, { workspaces: fake.workspaces, tenants: fake.tenants, access: fake.access, mailer, search: new MemoryCardSearch(), log: line => console.log(line) })
  return { auth, boards, all: [auth, boards] as const }
}

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
```

- **El orden es el orden de uso.** auth primero: todos los demás contextos dan acceso con
  él. boards después. Hoy boards no recibe nada de auth, solo el falso; el capítulo 20 le
  entrega los módulos de auth, y eso solo funciona si auth ya está abierto.
- **El falso se muda aquí** desde `index.ts`, con ana, carl y bea, hasta el capítulo 20.
- **`mailer`** viene de fuera, o es el de la consola: un test entrega uno que guarda los
  correos.
- **`all`** son los contextos en ese orden, con `as const` para que su tipo conozca a
  ambos.
- **`stopContexts`** los detiene al revés, el último abierto primero, para que ningún
  contexto se detenga mientras otro que lo usa sigue en marcha. El servidor no lo
  necesitará: un test o un script que abre los contextos sin ejecutarlos sí (el script de
  seed del capítulo 20).

### `runContexts`

Hasta ahora, `index.ts` servía boards con `serve` y arrancaba su worker a mano. Ctrl+C
mataba el proceso donde estuviera: una petición a medio responder, un job a medio
ejecutar, un store abierto. Con un contexto era tolerable; con dos, el orden importa.

**`runContexts`**, de `newt/application`, ejecuta los contextos de una aplicación. Le das
cada contexto, abierto, en orden, con cómo se sirve (`serving()`), y:

- **sirve** cada uno con un `serve`, y guarda los servidores en `servers`, por nombre de
  contexto. Si uno no puede arrancar (su puerto está ocupado), los que ya arrancaron se
  detienen y se lanza el error.
- **arranca** el worker de cada contexto, cuando todos los servidores están en marcha.
- **se detiene** con `stop()`, o con **SIGINT o SIGTERM**: cada servidor deja de aceptar
  peticiones y termina las que tiene en curso; luego cada contexto se detiene, el último
  primero, esperando cada uno sus jobs en curso y cerrando su store. Después el proceso
  termina. Llamar a `stop()` dos veces detiene una sola vez.

Lo que no hace es abrirlos, ni decidir su orden: eso es `openContexts`. Sustituye
`index.ts`:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { config } from './config'
import { openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

// For now, who sends a request to boards says who they are in an `x-user` header (chapter 22 signs them in).
contexts.boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId, via: 'web' as const } : null
})

const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })))
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)
```

El auth falso y el autenticador `x-user` de boards siguen como estaban, solo que movidos.
El autenticador se fija en el router de boards después de abrirlo y antes de que
`runContexts` lo sirva. El de auth no necesita nada aquí: lo fijó su módulo de sesiones.

`serving()` tiene ahora un segundo llamante. Actualiza su comentario en
`served-context.ts`:

```ts
// cooper/backend/shared/served-context.ts
  /** How it is served (`runContexts`, `serve`): its modules' API and its health. */
```

### Su test

```ts
// cooper/backend/open-contexts.test.ts
import { expect, test } from 'bun:test'
import { runContexts } from 'newt/application'
import { config, type Config } from './config'
import { openContexts } from './open-contexts'
import { RecordingMailer } from './shared/mail/recording-mailer'

/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: 0 },
    boards: { ...config.boards, database: ':memory:', port: 0 },
  }
}

test('opens the two contexts, serves each on its own port, and stops them', async () => {
  const mailer = new RecordingMailer()
  const mails = mailer.mails
  const contexts = await openContexts(testConfig(), { mailer })
  expect(contexts.all.map(context => context.name)).toEqual(['auth', 'boards'])

  const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })), { signals: false })
  try {
    const servers = Object.values(app.servers)
    expect(Object.keys(app.servers)).toEqual(['auth', 'boards'])
    expect(new Set(servers.map(server => server.port)).size).toBe(2)
    for (const server of servers) {
      const response = await fetch(new URL('/api/health', server.url))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    }
    // The API's own addresses are never the frontend's.
    expect((await fetch(new URL('/api/nothing', servers[0]!.url))).status).toBe(404)
  } finally {
    await app.stop()
  }
  expect(mails).toEqual([])
})
```

El test abre los dos contextos sobre bases de datos en memoria y puertos libres, y los
ejecuta con `{ signals: false }`: un test no debe quedarse con el Ctrl+C del ejecutor de
tests, ni terminar el proceso. Cada contexto responde a su health en su propio puerto, y
una dirección `/api` que ninguna ruta tiene es un 404. `app.stop()` en `finally` los
detiene como lo haría una señal. El `RecordingMailer` del [capítulo 12](./12-failures)
guarda lo que se enviaría: abrir y detener no envía ningún correo.

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 79 pass
 0 fail
```

Los tests nuevos por separado:

```sh
bun test cooper -t 'accounts|two contexts'
```

```text
 5 pass
 74 filtered out
 0 fail
 27 expect() calls
Ran 5 tests across 10 files.
```

Ahora arranca el backend:

```sh
bun cooper/backend/index.ts
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
```

Desde otra terminal, regístrate, guardando la cookie en un archivo, `jar`:

```sh
curl -si -c jar -X POST localhost:3001/api/session/sign-up -H 'content-type: application/json' \
  -d '{"email":"Ana@Cooper.Test","name":"Ana","password":"a long password"}'
```

```text
HTTP/1.1 201 Created
Content-Type: application/json;charset=utf-8
Set-Cookie: cooper_auth_session=Y9i_7mu09NI9u-8dC69REDQl-ymeF4xLH3xXvGDQdx0; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax
…

{"id":"01a17961-40be-7488-9bd4-82c7dc6219ae","email":"ana@cooper.test","name":"Ana","createdAt":"2026-10-26T18:02:59.135Z","updatedAt":"2026-10-26T18:02:59.135Z"}
```

El email se guarda en minúsculas, y la respuesta no lleva hash de contraseña. Con la
cookie, auth sabe quién eres; sin ella, no:

```sh
curl -s -b jar localhost:3001/api/session
curl -s localhost:3001/api/session
```

```text
{"id":"01a17961-40be-7488-9bd4-82c7dc6219ae","email":"ana@cooper.test","name":"Ana","createdAt":"2026-10-26T18:02:59.135Z","updatedAt":"2026-10-26T18:02:59.135Z"}
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

El mismo email otra vez, con otra capitalización, un registro de camino al backoffice,
una contraseña incorrecta y un email desconocido:

```sh
H='content-type: application/json'
curl -s -X POST localhost:3001/api/session/sign-up -H "$H" -d '{"email":"ANA@cooper.test","name":"Ana again","password":"a long password"}'
curl -s -X POST localhost:3001/api/session/sign-up -H "$H" -d '{"email":"bob@cooper.test","name":"Bob","password":"a long password","productId":"backoffice"}'
curl -s -X POST localhost:3001/api/session/sign-in -H "$H" -d '{"email":"ana@cooper.test","password":"wrong"}'
curl -s -X POST localhost:3001/api/session/sign-in -H "$H" -d '{"email":"nobody@cooper.test","password":"a long password"}'
```

```text
{"error":"There is an account with this email already: sign in instead","code":"user.email_taken"}
{"error":"Cooper Backoffice does not take new accounts: ask someone who runs it for access","code":"session.sign_up_closed"}
{"error":"The email and the password do not match","code":"session.invalid_credentials"}
{"error":"The email and the password do not match","code":"session.invalid_credentials"}
```

Mira qué guarda auth (`sqlite3` lee el archivo mientras el servidor funciona):

```sh
sqlite3 data/cooper-auth.db 'SELECT email, substr(password_hash, 1, 30) FROM "user"; SELECT token_hash FROM session;'
```

```text
ana@cooper.test|$argon2id$v=19$m=65536,t=2,p=1
6765821d0574d0ca0fd4b32007d69c8bd470a372904e7a70af6a4ca3a59bbcf4
```

Un hash argon2id, no la contraseña; un SHA-256 del token, no el token de tu `jar`. Cierra
sesión, y la cookie se borra y la sesión desaparece:

```sh
curl -si -b jar -c jar -X POST localhost:3001/api/session/sign-out
curl -s -b jar localhost:3001/api/session
```

```text
HTTP/1.1 204 No Content
Set-Cookie: cooper_auth_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
…

{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

boards sigue respondiendo en el 3002 con `x-user`, como antes. Ahora pulsa Ctrl+C en la
terminal del servidor (o envíale `kill -TERM`): los dos servidores dejan de aceptar
peticiones, se detiene boards, luego auth, y el proceso termina con código 0.

## En resumen

- Un contexto es su propia base de datos, sus módulos, sus migraciones y su puerto. Uno
  que no usa ningún otro lo dice en el `contexts.uses` del lint (`auth: []`), y
  `newt/context-boundaries` mantiene a todos los demás fuera de sus archivos.
- Una entidad con un secreto tiene un esquema público: `Entity<typeof Kept, typeof Public>`,
  pasado el último a `super`. `toDTO()` da solo los campos públicos, así que el secreto
  nunca llega a una respuesta ni a un evento; el repositorio lo guarda todo.
- Guarda un hash, nunca el secreto: `Bun.password` para contraseñas, `SecretToken.hash`
  para tokens. Di lo mismo, y tarda lo mismo, tenga cuenta el email o no.
- Las rutas para las que nadie puede haber iniciado sesión dicen `{ public: true }`. Una
  sesión vive en una cookie `httpOnly`, `sameSite: 'lax'`; un módulo puede fijar el
  autenticador de su contexto.
- `writesTo` es la excepción a la regla de escritura dentro de un contexto, cuando la
  persona espera las dos escrituras: di por qué, y asegúrate de que un fallo entre ambas
  no deje nada a medias.
- `runContexts` sirve todos los contextos, arranca sus workers, y con SIGINT o SIGTERM
  detiene los servidores y luego los contextos, el último abierto primero. Abrirlos en
  orden es cosa tuya (`openContexts`).

Siguiente: [Tenants y acceso](./18-tenants-and-access).
