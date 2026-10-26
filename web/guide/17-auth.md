# A second context: auth

Since chapter [4](./04-who-and-where), `boards` has asked a fake who belongs to each
workspace, and every request has said who sent it in an `x-user` header. Anyone could
be anyone. cooper needs accounts: an email, a name and a password, and a way to sign
in that a browser keeps.

None of that is boards' business. Who someone is serves every app of cooper: the
boards, the staff's backoffice later, an AI assistant through MCP. So it gets a
context of its own, **`auth`**, with its own database, its own modules and its own
server, on port 3001. It uses no other context. This chapter builds its first three
modules: the products it signs people in to, the accounts, and the sessions of auth
itself. It also runs both contexts in one process, which is where the signal handling
that chapter [1](./01-project-and-context) left out finally comes in.

boards does not use auth yet. It keeps asking the fake, and keeps its `x-user`
header, until chapters [20](./20-wiring-contexts) and [22](./22-web-session) wire it
to auth.

At the end you will have these files:

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

## Its settings

auth listens on 3001 and keeps its data in its own SQLite file. It also needs to know
where the apps it signs people in to are opened, and how long a session lasts. In
`config.ts`, add `sessionDays` after `env`, the backoffice's public URL (its app comes
in chapter [25](./25-backoffice), but auth names it from now on), and auth's part,
before boards':

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

`sessionDays` is outside `auth` because it is "in every context": chapter 22 gives
boards a browser session of its own, which lasts as long.

The context's type of settings is its part of `Config`, as boards' is:

```ts
// cooper/backend/contexts/auth/auth-config.ts
import type { Config } from '../../config'

/** The settings of `auth`, from `config.ts`. */
export type Auth_Config = Config['auth']
```

## The base

auth's modules receive cooper's base, as boards' do: the store, the invocations, the
bus, the jobs, and the router. auth needs nothing more yet, but it gets its own class
from the start, so its modules say they are auth's:

```ts
// cooper/backend/contexts/auth/auth-base.ts
import { CooperBase } from '../../shared/cooper-base'

/**
 * What `auth`'s modules receive: cooper's base. For now nothing more: chapter 21 adds
 * a second router, for OAuth's addresses.
 */
export class AuthBase extends CooperBase {}
```

## The lint knows a second context

Each context lives in its own folder under `contexts/`, and the lint's `contexts`
setting says which ones each one may import. auth uses none. Add it in
`eslint.config.js`:

```js
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: [] } },
})
```

`uses` lists every context. A folder it does not list uses no other, so leaving auth
out would lint the same today; say it anyway, so the shape of the application is in
one place. boards uses none either, for now: it only reaches auth through ports, and
what it is handed comes from whoever opens it. When a file of one context imports
another's, `newt/context-boundaries` stops it. Try it: import `BoardsBase` in
`auth-base.ts`, and `bun run lint` says

```text
error  '../boards/boards-base' is the context boards's, and auth uses no other context: contexts use only the ones they say, never in a cycle  newt/context-boundaries
```

A context `uses` naming one that does not exist, or a cycle (auth using boards while
boards uses auth), throws as soon as the lint starts. Take the import out again.

## Products: a module with no entity

auth signs people in to cooper's apps, and it has to know them: their names, where
they are opened, and whether someone may make an account on the way to one. The boards
take anyone; the backoffice only the staff it was told.

Those apps are pieces of the system, not data anyone edits. Nobody adds a product from
a form: a new one is new code. So they are declared in code, and the product module
keeps them in memory. First what a product is, and the ids other code names:

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

`WORKSPACES_PRODUCT` is the product whose tenants are boards' workspaces. Chapter
[13](./13-another-context) left `'cooper'` written in `card.workers.ts`, waiting for
this constant. It stays a literal a little longer: importing it from boards needs the
lint's `boards: ['auth']`, which comes in chapter 20. Change only its comment there:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
  // For now the product is named here: auth's WORKSPACES_PRODUCT (chapter 20) takes its place.
```

The module is given its products as an option:

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

A module is a set of use cases, not a table. This one has no entity and no repository,
and still is a module: its `get` is a use case like any other, which other modules
call, and which runs as one. It checks each product with its schema as it starts, so
a typo in the declarations fails when the context opens, not when someone signs in.
`get` hands out a copy (`structuredClone`), so no caller can change what the module
keeps.

## Accounts

The user module keeps the accounts. Two things set it apart from every module so far:
it keeps a secret, and one of its rules (an email belongs to one account) is about all
of its rows.

### What anyone sees: the schema

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

- **`UserSchema` is the account as anyone sees it**: an id, an email, a name, its
  dates. It has no password, nor its hash. This file is the module's contract, what
  other modules, contexts and frontends see, so a secret has no place in it.
- **The email is newt's `Email`**, which you met in chapter 4: trimmed and in lower
  case, branded, so a plain string is not one until it went through `Email.from` or
  `Email.schema`. `Email.schema` takes an email only **as it is kept**: in lower case.
  That is how one account per email "whatever its case" becomes a plain comparison:
  `Ana@Cooper.Test` and `ana@cooper.test` are kept as the same string.
- **What someone types is lenient.** `UserSignUpSchema` takes the email as typed, with
  a plain `z.email()`: `Email.schema` would refuse `Ana@Cooper.Test` for its capital
  letters. The entity runs it through `Email.from` before keeping it. Input schemas
  take what people type; the entity's schema takes only what is kept.
- `UserPasswordSchema` keeps a password between 8 and 128 characters: long enough,
  never so long that hashing it costs the server.

### What is kept: the entity, with a public schema

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

The account is kept with its password's hash, which must never leave auth. So the
entity has **two schemas**:

- **`UserEntitySchema`**, everything it keeps: `UserSchema` extended with
  `passwordHash`. It is the first argument to `Entity` and to `super`.
- **`UserSchema`**, its **public schema**: what anyone else sees. It is the second type
  argument, `Entity<typeof UserEntitySchema, typeof UserSchema>`, and the last
  argument of `super`.

With a public schema, `toDTO()` gives only its fields, and the repository still stores
them all. Every way out of the module goes through `toDTO()`: what a use case returns,
what a route answers, and the event `signUp` tracks, `new User_SignedUp(user.toDTO())`.
So the hash never reaches an event, an outbox job, a log line or an answer, without
anyone remembering to leave it out.

newt holds you to it in both directions. The entity's schema must have every field of
the public one: a public schema with a field the entity does not keep throws as the
entity is built. And when the second type argument differs from the first, the
constructor's last argument is required: an entity that says it has a public schema
and does not pass it does not compile.

The entity uses the hash in one place, `get passwordHash()`, which the module reads
to check a password. A getter is not data: `toDTO()` does not see it.

`User.signUp` takes the password already hashed. Hashing is slow on purpose, and
`async`; an entity's methods are neither. The module hashes, the entity keeps.

Its event and its errors:

```ts
// cooper/backend/contexts/auth/modules/user/events/user-signed-up.ts
import type { DomainEvent } from 'newt/core'
import type { UserDTO } from '../user.schema'

/** Someone made an account: who they are, never their password. */
export class User_SignedUp implements DomainEvent<UserDTO> {
  static readonly eventName = 'user.signedUp'
  readonly name = User_SignedUp.eventName
  readonly occurredAt = new Date().toISOString()
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

`EmailTaken` is a `ConflictError`, a 409, like `BoardNameTaken`.

### One account per email: the repository

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

This is chapter [6](./06-rules-over-rows)'s board name again: a rule over rows,
checked in the save. `persistWithEmailFree` writes the account, then, in the same
transaction, counts the accounts with its email, and throws `EmailTaken` if there are
two. The save rolls back, and nothing is kept.

The `guard` is the email itself, `userEmail:<email>`: two sign-ups with the same email
take turns, on any store, while sign-ups with different emails do not wait for each
other. Since the email is kept in lower case, `ANA@cooper.test` and `ana@cooper.test`
share the key and the count finds both.

Board names had a unique index too, as the last word. The email has none, on purpose:
the table's index on `email` (below) only makes the lookup fast. The check in the save
is enough, and it holds the same on SQLite, Postgres or any store you write, which is
what the comment says. (Chapter [18](./18-tenants-and-access) shows the other way, a
unique index whose `DuplicateValue` the module turns into its own error.)

### The use cases

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

- **`signUp`** parses the input, hashes the password with `Bun.password.hash`
  (argon2id, salted, with its settings inside the hash), and builds the account.
  Then the usual two steps: a `count` first, for a clear answer in the usual case;
  then `persistWithEmailFree`, which checks again where nothing slips in between. It
  returns `user.toDTO()`: no hash.
- **`verifyPassword`** is how a password is checked, and it tells nothing to whoever
  tries. An unknown email and a wrong password both give `null`. They also take as
  long: with no account, `Bun.password.verify` still runs, against `NOBODY`, a hash
  made once when the module is loaded. Without it, an unknown email would answer at
  once and a known one after a slow hash, and the time alone would say which emails
  have an account. The email is lower-cased and checked with `Email.schema`, so
  `ANA@cooper.test` finds Ana, and something that is not an email finds nobody.
- **`get`**, for other modules: an account by its id, or `UserNotFound`.

The user module has no routes. People reach it through the session module, which
signs them in as they sign up.

### Its table

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

auth's migrations are its own, numbered from `00001` in its own folder: each context
has its own database, and brings its own up to date as it opens. `user` is a word SQL
keeps, so its name is always quoted.

## Sessions

Once someone signs up or in, the browser has to be told it is them on every request
that follows. auth hands it a **token** in a cookie, and keeps the session: whose it
is and until when.

### A token, and only its hash

A token is a key: whoever has it is signed in. newt's **`SecretToken`**, from
`newt/core`, is one: 32 random bytes in base64url, from `SecretToken.generate()`.
Like `Email`, it is branded: a string from a cookie is a `SecretToken` only once
`SecretToken.schema` or `SecretToken.from` checked it. The store never keeps the
token, only `SecretToken.hash(token)`, a SHA-256: a copy of the database, a backup or
a leak, opens nothing. And since the token is random and long, a fast hash is enough;
a password needs a slow one because people choose short ones.

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

- **Its schema lives here, not in `session.schema.ts`.** Nobody else sees a session;
  what others see is "who is signed in", an account. So it is not part of the module's
  contract, and it needs no public schema: no DTO of it ever leaves the module.
- **`Session.open`** makes the token, keeps its hash in a new session, and gives back
  both: the session for the store, the token for the browser. The server keeps no
  copy: from then on it only sees the token when the browser sends it back.
- **`close`** is `markAsDeleted()`. Its repository is not a soft-delete one, so saving
  it deletes the row: a closed session is not history.
- It reads the time with `Date.now()` and `new Date()` for now. Chapter
  [19](./19-invitations-and-time) gives every context a clock that tests can move.

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

`token_hash` is `UNIQUE`: it is how a session is found, and two random tokens never
share a hash.

### What it takes

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

- **The cookie's name** says it is auth's. Browsers keep cookies by host, not by port,
  so in development every context on `localhost` shares them. When boards has a
  session cookie of its own (chapter 22), the two must not have the same name.
- **`SessionSignUpSchema`** is the user's sign-up schema with one field more: the
  product that sent the person here, if any.

Its errors, its options and what it uses:

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

`InvalidCredentials` is an `UnauthorizedError`, a 401, and says the same whether the
email has no account or the password is wrong. `SignUpClosed` is a 403.

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

### The routes, public, and the cookie

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

Every route needs someone signed in (chapter [2](./02-first-module)), and nobody is
signed in before signing up or in. So those routes say **`{ public: true }`**: the
router runs them without asking the authenticator, with no actor. A public route
must not reach a use case that asks `currentActor()`; these three do not.

Sign-out is public too. Someone whose session already expired, or was closed from
another tab, should still get their cookie cleared, not a 401.

`GET /session`, who is signed in, is not public: without a session the router
answers a 401, `not_signed_in`, before the route runs.

`keep` sets the cookie with Bun's `request.cookies`, which the response carries back
as `Set-Cookie`:

- **`httpOnly`**: the page's scripts cannot read it. A script injected in a page
  cannot steal the session.
- **`sameSite: 'lax'`**: another site's page cannot make the browser send it with a
  form it posts.
- **`maxAge`**: as long as the session, so the browser forgets it when auth does.
- **`secure`** when the request came over https: in production it is never sent in the
  clear; in development, on `http://localhost`, it still works.

The routes read the body as JSON and hand it on: the use cases validate everything.

### The use cases

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

**`initialize` sets auth's authenticator.** In boards, `index.ts` said who sends each
request. In auth, the session module knows: it registers
`base.http.authenticateWith(...)` itself, taking the cookie's token to `authenticate`.
Whoever opens auth gets a router that already knows its sessions, in the server and in
every test.

- **`signUp`** checks the product first, if there is one: `cooper` takes new
  accounts, `backoffice` does not, and answers `SignUpClosed` before any account is
  made. Without a product (someone who came to auth directly) anyone may sign up.
  Then it has the user module make the account, and opens a session for it.
- **`signIn`** asks `verifyPassword`, and answers `InvalidCredentials` for `null`,
  whichever the reason was.
- **`signOut`** closes the session of the token, if it is one. A token that finds no
  session (signed out already, or never one) does nothing: signing out twice is
  signing out once.
- **`me`** is the account of whoever is acting, `currentActor().userId`, which the
  router set from the cookie.
- **`authenticate`** finds the session by its token's hash, and gives back the actor,
  `{ userId, via: 'web' }`, or `null`. An expired session is closed as it is found, so
  the next time there is nothing to find.
- **`find`** checks the token's shape with `SecretToken.schema.safeParse` before it
  hashes it: a cookie is whatever the browser sent, and something that is not a token
  is no session, not an error.

### Writing to another module: `writesTo`, inside one context

`session.signUp` saves twice: the account, through `user.signUp`, and the session, in
its own module. That is a write to another module outside a worker, which the write
rule refuses (chapter [8](./08-two-people-one-card)): run it without `writesTo` and it
throws `[write rule] session.signUp writes to auth.user outside a worker`.

The other way would be the usual one: the user module tells `user.signedUp`, and a
worker opens the session. But a session opened a moment later is no use to someone
waiting for the answer to their sign-up, with a cookie in it. So it writes directly,
and says so: `@UseCase({ writesTo: ['user'] })`, with the reason in the comment.

Look at what a failure leaves. The account is saved first, in its own transaction.
If opening the session then fails, the account stays, and the person signs in. Nothing
is half made: an account without a session is an ordinary account. That is what makes
the exception acceptable, as it was for `removeColumn`, whose only write was the
column's.

The rule is per context. `writesTo: ['user']` names a module of auth, the one this
use case is in. A use case of another context that calls auth's is a different story,
which chapter 20 tells.

## The context

The list of auth's modules, each after those it uses. `declaredProducts` is cooper's
products, with their public URLs from the config:

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

The outbox module from chapter [12](./12-failures) is here too: auth's dead jobs, over
auth's own store. auth makes no jobs yet, but each context keeps one from the start.

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

It is boards' context again, with its own name, its own database file and its own
migrations folder. Each context opens its own store: auth's accounts and boards' cards
never share a transaction, and one could move to another database without the other
noticing.

## Its tests

auth's tests open the real context, on a database in memory:

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

- **The first** signs Ana up with ` Ana@Cooper.Test `, gets `ana@cooper.test` back, and
  no `passwordHash`. Another account with `ANA@cooper.test` is taken. Two sign-ups for
  Bob at the same moment, in two cases: one wins, one fails.
- **The second** checks the password, in any case of the email, and that a wrong
  password and an unknown email look the same.
- **The third** opens a session at sign-up, authenticates its token, refuses a
  sign-up to the backoffice, and signs out: the token opens nothing after.
- **The last** goes through HTTP: it serves the context on a free port, signs up and
  gets a cookie marked `HttpOnly`, sends it back to `GET /session`, gets a 401 without
  it, and signs out.

## Every context in one process

cooper now has two contexts, and its backend runs them both. Opening them is one
function, so the server, the tests and later the scripts open them the same way:

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

- **The order is the order of use.** auth first: every other context signs people in
  with it. boards after. Today boards gets nothing from auth, only the fake; chapter
  20 hands it auth's modules, and that only works if auth is already open.
- **The fake moves here** from `index.ts`, with ana, carl and bea, until chapter 20.
- **`mailer`** comes from outside, or is the console's: a test hands one that keeps
  the mails.
- **`all`** is the contexts in that order, `as const` so its type knows both.
- **`stopContexts`** stops them the other way round, the last opened first, so no
  context stops while one that uses it still runs. The server will not need it: a test
  or a script that opens the contexts without running them does (chapter 20's seed
  script).

### `runContexts`

Until now, `index.ts` served boards with `serve` and started its worker by hand. Ctrl+C
killed the process wherever it was: a request half answered, a job half run, a store
left open. With one context that was tolerable; with two, the order matters.

**`runContexts`**, from `newt/application`, runs an application's contexts. You give it
each context, opened, in order, with how it is served (`serving()`), and it:

- **serves** each one with a `serve`, and keeps the servers in `servers`, by context
  name. If one cannot start (its port is taken), the ones already started stop and
  the error is thrown.
- **starts** each context's worker, after every server is up.
- **stops** on `stop()`, or on **SIGINT or SIGTERM**: every server stops taking
  requests and finishes those in progress; then each context stops, the last one first,
  each waiting for its jobs in progress and closing its store. Then the process ends.
  Calling `stop()` twice stops once.

What it does not do is open them, or decide their order: that is `openContexts`.
Replace `index.ts`:

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

The fake auth and the `x-user` authenticator for boards stay as they were, only moved.
The authenticator is set on boards' router after it opens and before `runContexts`
serves it. auth's needs nothing here: its session module set it.

`serving()` now has a second caller. Update its comment in `served-context.ts`:

```ts
// cooper/backend/shared/served-context.ts
  /** How it is served (`runContexts`, `serve`): its modules' API and its health. */
```

### Its test

```ts
// cooper/backend/open-contexts.test.ts
import { expect, test } from 'bun:test'
import { runContexts } from 'newt/application'
import { config, type Config } from './config'
import { openContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'

/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: 0 },
    boards: { ...config.boards, database: ':memory:', port: 0 },
  }
}

test('opens the two contexts, serves each on its own port, and stops them', async () => {
  const mails: Mail[] = []
  const contexts = await openContexts(testConfig(), { mailer: { send: async mail => { mails.push(mail) } } })
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

The test opens both contexts on databases in memory and free ports, and runs them with
`{ signals: false }`: a test must not take over the test runner's Ctrl+C, nor end the
process. Each context answers its health on its own port, and an `/api` address no
route has is a 404. `app.stop()` in `finally` stops them as a signal would. No mail is
sent by opening and stopping.

## Check it

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

```text
 68 pass
 0 fail
```

The new tests on their own:

```sh
bun test cooper -t 'accounts|two contexts'
```

```text
 5 pass
 63 filtered out
 0 fail
 27 expect() calls
Ran 5 tests across 10 files.
```

Then start the backend:

```sh
bun cooper/backend/index.ts
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
```

From another terminal, sign up, keeping the cookie in a file, `jar`:

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

The email is kept in lower case, and the answer has no password hash. With the cookie,
auth knows who you are; without it, it does not:

```sh
curl -s -b jar localhost:3001/api/session
curl -s localhost:3001/api/session
```

```text
{"id":"01a17961-40be-7488-9bd4-82c7dc6219ae","email":"ana@cooper.test","name":"Ana","createdAt":"2026-10-26T18:02:59.135Z","updatedAt":"2026-10-26T18:02:59.135Z"}
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

The same email again, in another case, a sign-up on the way to the backoffice, a wrong
password and an unknown email:

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

Look at what auth keeps (`sqlite3` reads the file while the server runs):

```sh
sqlite3 data/cooper-auth.db 'SELECT email, substr(password_hash, 1, 30) FROM "user"; SELECT token_hash FROM session;'
```

```text
ana@cooper.test|$argon2id$v=19$m=65536,t=2,p=1
6765821d0574d0ca0fd4b32007d69c8bd470a372904e7a70af6a4ca3a59bbcf4
```

An argon2id hash, not the password; a SHA-256 of the token, not the token in your
`jar`. Sign out, and the cookie is cleared and the session gone:

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

boards still answers on 3002 with `x-user`, as before. Now press Ctrl+C in the
server's terminal (or send it `kill -TERM`): both servers stop taking requests, boards
stops, then auth, and the process ends with code 0.

## What to remember

- A context is its own database, modules, migrations and port. One that uses no other
  says so in the lint's `contexts.uses` (`auth: []`), and `newt/context-boundaries`
  keeps every other one out of its files.
- An entity with a secret has a public schema: `Entity<typeof Kept, typeof Public>`,
  passed last to `super`. `toDTO()` gives only the public fields, so the secret never
  reaches an answer or an event; the repository stores everything.
- Keep a hash, never the secret: `Bun.password` for passwords, `SecretToken.hash` for
  tokens. Say the same, and take as long, whether an email has an account or not.
- Routes nobody can be signed in for say `{ public: true }`. A session lives in an
  `httpOnly`, `sameSite: 'lax'` cookie; a module may set its context's authenticator.
- `writesTo` is the exception to the write rule inside one context, when the person
  waits for both writes: say why, and make sure a failure between them leaves nothing
  half made.
- `runContexts` serves every context, starts their workers, and on SIGINT or SIGTERM
  stops the servers, then the contexts, the last opened first. Opening them in order
  is yours (`openContexts`).

Next: [Tenants and access](./18-tenants-and-access).
