# Iniciar sesión

El monitor muestra de qué están hechas las aplicaciones que vigila: nadie que no deba
puede verlo. Una persona inicia sesión, con un usuario y una contraseña del entorno del
monitor, y recibe una sesión, desde los navegadores que quiera. Todas las rutas menos
la de iniciar sesión la necesitan.

Este es el primer módulo del monitor, `session`. Tiene una entidad, un repositorio, una
tabla, casos de uso y rutas: la anatomía que tiene todo módulo de newt ([capítulo 2 del
tutorial](../guide/02-first-module)).

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/
  config.ts                         cambia: el usuario, la contraseña, la URL pública
  testing/open-test-monitor.ts      cambia: el admin del test, un navegador con sesión iniciada
  contexts/monitor/
    monitor.context.ts              cambia: sus migraciones
    initialize-modules.ts           cambia: el módulo session
    migrations/sqlite/
      00001_session_up.sql          la tabla session
      00001_session_down.sql
    modules/session/
      session.schema.ts             la sesión, lo que envía quien inicia sesión, la cookie
      session.ts                    la entidad
      session.repository.ts
      session-options.ts            quién puede iniciar sesión, y por cuánto tiempo
      session.module.ts             iniciar y cerrar sesión, y quién es una petición
      session.routes.ts             POST, GET y DELETE /api/session
      errors/wrong-credentials.ts
      session.test.ts
```

## Quién puede iniciar sesión

Tres variables más. El usuario y la contraseña no tienen valor por defecto: un monitor
que nadie ha configurado no arranca. La URL pública dice si el monitor se abre por
HTTPS, lo que hace su cookie `Secure`.

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

## La sesión

Una sesión es una fila cuyo token solo guarda el navegador: la tabla tiene su hash, así
que una copia de la base de datos no abre nada. El `SecretToken` de newt crea el token
y calcula su hash.

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

El contexto abre ahora su store con sus migraciones, que newt ejecuta al abrirlo:

```ts
// packages/newt-monitor/src/contexts/monitor/monitor.context.ts
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations/sqlite') })
```

La entidad abre una sesión para unas horas, dice si ha terminado, y la cierra. Su fin
se calcula con `now()`, el reloj del contexto, así que un test mueve el tiempo en vez de
esperar:

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

## Iniciar sesión, en el mismo tiempo sea cual sea el error

Comparar una contraseña con `===` se detiene en el primer carácter distinto: lo que
tarda dice cuánto de ella era correcto. El módulo compara el hash de cada texto, todos
de la misma longitud, con `timingSafeEqual`, y comprueba el usuario y la contraseña
antes de decidir, así que un usuario incorrecto responde tan tarde como una contraseña
incorrecta. El error no dice cuál de los dos era.

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

`WrongCredentials` es un `UnauthorizedError`: un 401, `session.wrong_credentials`.

## Quién es una petición

El router pregunta al módulo quién envió cada petición, a partir de su cookie; una ruta
que no es `public` responde un 401 a quien no es nadie. Una sesión caducada se cierra
la primera vez que se usa:

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

## Las rutas

El token va en una cookie que los scripts de la página no pueden leer (`HttpOnly`), que
nunca envía una página de otro sitio (`SameSite=Strict`), y solo por HTTPS cuando el
monitor se abre por HTTPS. Dura lo mismo que la sesión (`Max-Age`).

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

`initializeModules` le da al módulo lo que dice la configuración:

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

`openTestMonitor` tiene ahora un admin propio, y da un navegador con su sesión
iniciada: el `browser` de newt (`newt/testing`) guarda las cookies que pone un
servidor, como hace un navegador.

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

Los casos difíciles: un usuario incorrecto y una contraseña incorrecta responden igual;
cerrar sesión dos veces es cerrarla una; una sesión termina cuando se cumplen sus
horas, con el reloj movido a mano.

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

## Compruébalo

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

## Lo que todavía no hace

No frena a quien prueba contraseña tras contraseña: ponlo detrás de tu red, y usa una
contraseña larga. Un límite de intentos puede venir más adelante.

## Qué recordar

- Un módulo del monitor es un módulo de newt: esquema, entidad, repositorio, casos de
  uso, rutas, y su test.
- Compara secretos en el mismo tiempo sean cuales sean: hashes, `timingSafeEqual`, los
  dos comprobados antes de decidir, y un solo error para todas las formas de
  equivocarse.
- El navegador guarda el token, el store su hash; la cookie es `HttpOnly`,
  `SameSite=Strict`, y `Secure` por HTTPS.
- `authenticateWith` hace que todas las rutas necesiten una sesión; `public: true` es
  la excepción, dicha donde está la ruta.

Siguiente: [un secreto que cifra](./03-a-secret-that-encrypts).
