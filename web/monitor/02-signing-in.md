# Signing in

The monitor shows what the applications it watches are made of: nobody who is not
meant to may see it. One person signs in, with a user and a password from the
monitor's environment, and gets a session, from any number of browsers. Every route
but signing in needs it.

This is the monitor's first module, `session`. It has an entity, a repository, a
table, use cases and routes: the anatomy every module of newt has ([chapter 2 of the
guide](../guide/02-first-module)).

At the end you will have these files:

```
packages/newt-monitor/src/
  config.ts                         changed: the user, the password, the public URL
  testing/open-test-monitor.ts      changed: the test's admin, a browser signed in
  contexts/monitor/
    monitor.context.ts              changed: its migrations
    initialize-modules.ts           changed: the session module
    migrations/sqlite/
      00001_session_up.sql          the session table
      00001_session_down.sql
    modules/session/
      session.schema.ts             the session, what signing in sends, the cookie
      session.ts                    the entity
      session.repository.ts
      session-options.ts            who may sign in, for how long
      session.module.ts             signing in and out, and who a request is
      session.routes.ts             POST, GET and DELETE /api/session
      errors/wrong-credentials.ts
      session.test.ts
```

## Who may sign in

Three more variables. The user and the password have no default: a monitor nobody
configured does not start. The public URL says whether the monitor is opened over
HTTPS, which makes its cookie `Secure`.

```ts
// packages/newt-monitor/src/config.ts
  /** Where people open it: its session cookie is `Secure` when this is `https`. */
  NEWT_MONITOR_PUBLIC_URL: z.url().default('http://localhost:4800'),
  /** Who signs in to it: no default, so a monitor nobody configured does not start. */
  NEWT_MONITOR_USER: z.string().trim().min(1),
  /** Their password: 12 characters or more. */
  NEWT_MONITOR_PASSWORD: z.string().min(12),
  /** How long a session lasts. */
  NEWT_MONITOR_SESSION_HOURS: z.coerce.number().int().min(1).default(12),
```

## The session

A session is a row whose token only the browser keeps: the table has its hash, so a
copy of the database opens nothing. newt's `SecretToken` makes the token and hashes it.

```sql
-- packages/newt-monitor/src/contexts/monitor/migrations/sqlite/00001_session_up.sql
-- The monitor's sessions: one person signs in, from many browsers. Only the hash of
-- each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
```

The context now opens its store with its migrations, which newt runs as it opens:

```ts
// packages/newt-monitor/src/contexts/monitor/monitor.context.ts
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations/sqlite') })
```

The entity opens a session for some hours, tells whether it is over, and closes it.
Its end is `now()`, the context's clock, so a test moves time instead of waiting:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/session/session.ts
  /** A new session, for `hours`: its token, which only the browser keeps, and the session that keeps its hash. */
  static open(hours: number): { session: Session, token: SecretToken } {
    const token = SecretToken.generate()
    const expiresAt = new Date(now().getTime() + hours * 60 * 60_000).toISOString()
    return { session: new Session({ tokenHash: SecretToken.hash(token), expiresAt }, true), token }
  }

  isExpired(at = now()): boolean {
    return new Date(this.data.expiresAt) <= at
  }
```

## Signing in, in the same time whatever is wrong

Comparing a password with `===` stops at the first character that differs: how long
it takes says how much of it was right. The module compares each text's hash, all
of the same length, with `timingSafeEqual`, and checks both the user and the
password before it decides, so a wrong user answers as late as a wrong password. The
error says neither which it was.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/session/session.module.ts
function same(given: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(given), digest(expected))
}
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/session/session.module.ts
  @UseCase()
  async signIn(input: unknown): Promise<{ token: SecretToken, me: MeDTO }> {
    const { user, password } = SignInSchema.parse(input)
    const rightUser = same(user, this.options.user)
    const rightPassword = same(password, this.options.password)
    if (!rightUser || !rightPassword) throw new WrongCredentials()
    const { session, token } = Session.open(this.options.hours)
    await this.repo.persist(session)
    return { token, me: { user: this.options.user } }
  }
```

`WrongCredentials` is an `UnauthorizedError`: a 401, `session.wrong_credentials`.

## Who a request is

The router asks the module who sent each request, from its cookie; a route that is
not `public` answers a 401 to nobody. An expired session is closed the first time it
is used:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/session/session.module.ts
  @UseCase()
  async authenticate(token: string | undefined): Promise<Actor | null> {
    const session = await this.find(token)
    if (!session) return null
    if (session.isExpired()) {
      session.close()
      await this.repo.persist(session)
      return null
    }
    return { userId: this.options.user }
  }
```

## The routes

The token goes in a cookie the page's scripts cannot read (`HttpOnly`), never sent by
a page of another site (`SameSite=Strict`), over HTTPS only when the monitor is
opened over HTTPS. It lasts as long as the session (`Max-Age`).

```ts
// packages/newt-monitor/src/contexts/monitor/modules/session/session.routes.ts
export function registerSessionRoutes(base: MonitorBase, sessions: Session_Module, options: Session_Options): void {
  // Every route of the context runs as whoever its session cookie says: none, a 401.
  base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(SESSION_COOKIE) ?? undefined))

  // Signing in: the token goes in a cookie the page's scripts cannot read, sent only to this origin.
  base.http.post('/session', async request => {
    const { token, me } = await sessions.signIn(await request.json())
    request.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: options.secureCookie, path: '/', maxAge: options.hours * 60 * 60 })
    return Response.json(me)
  }, { public: true })

  base.http.get('/session', async () => Response.json(await sessions.me()))

  // Public: signing out with a session already gone still clears the cookie.
  base.http.delete('/session', async request => {
    await sessions.signOut(request.cookies.get(SESSION_COOKIE) ?? undefined)
    request.cookies.delete({ name: SESSION_COOKIE, path: '/' })
    return new Response(null, { status: 204 })
  }, { public: true })
}
```

`initializeModules` gives the module what the settings say:

```ts
// packages/newt-monitor/src/contexts/monitor/initialize-modules.ts
export function initializeModules(base: MonitorBase, config: MonitorConfig) {
  const session = Session_Module.initialize(base, {
    ...config.admin,
    hours: config.sessionHours,
    secureCookie: new URL(config.publicUrl).protocol === 'https:',
  })
  return { session }
}
```

## Tests

`openTestMonitor` now has an admin of its own, and gives a browser signed in as them:
newt's `browser` (`newt/testing`) keeps the cookies a server sets, as a browser does.

```ts
// packages/newt-monitor/src/testing/open-test-monitor.ts
    /** A browser signed in as the test's admin: it keeps the session's cookie. */
    async signedIn() {
      const as = browser(url)
      const response = await as('/api/session', { method: 'POST', json: TEST_ADMIN })
      if (!response.ok) throw new Error(`signing in answered ${response.status}`)
      return as
    },
```

The hard cases: a wrong user and a wrong password answer the same; signing out twice is
signing out once; a session ends when its hours are up, the clock moved by hand.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/session/session.test.ts
  test('ends once its hours are up', async () => {
    const as = await monitor.signedIn()

    time += 59 * 60_000
    expect((await as('/api/session')).status).toBe(200)
    time += 60_000
    expect((await as('/api/session')).status).toBe(401)
  })
```

## Check it

```sh
bun test packages/newt-monitor
NEWT_MONITOR_USER=ana NEWT_MONITOR_PASSWORD='a long password' bun run monitor
```

```sh
curl -si localhost:4800/api/session -H 'content-type: application/json' \
  -d '{"user":"ana","password":"a long password"}'
```

```
HTTP/1.1 200 OK
Set-Cookie: newt_monitor_session=…; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict
```

## What it does not do yet

It does not slow down whoever tries password after password: put it behind your
network, and use a long password. A limit on attempts can come later.

## What to remember

- A module of the monitor is a module of newt: schema, entity, repository, use cases,
  routes, and its test.
- Compare secrets in the same time whatever they are: hashes, `timingSafeEqual`, both
  checked before deciding, and one error for every way of being wrong.
- The browser keeps the token, the store its hash; the cookie is `HttpOnly`,
  `SameSite=Strict`, and `Secure` over HTTPS.
- `authenticateWith` makes every route need a session; `public: true` is the
  exception, said where the route is.

Next: [a secret that encrypts](./03-a-secret-that-encrypts).
