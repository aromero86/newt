# En producción

cooper arranca en tu máquina con un comando. Este último capítulo repasa lo que hay
alrededor de los contextos: los scripts, cómo arranca y para el backend, la
configuración que lee, qué pasa cuando más de un proceso trabaja sobre los mismos datos y
qué cambiaría si cooper dejara SQLite.

## Los scripts

Están en el `package.json` de la raíz:

```json
"cooper": "bun run cooper/scripts/dev.ts --watch",
"cooper:seed": "bun run cooper/scripts/seed.ts",
"cooper:migrations": "bun run cooper/scripts/migrations.ts",
"cooper:build": "vite build cooper/frontend/auth && vite build cooper/frontend/boards && vite build cooper/frontend/backoffice"
```

### `cooper:seed`: datos de ejemplo, por los casos de uso

El seed abre los contextos como el servidor y escribe con sus casos de uso, como lo haría
cualquiera: una cuenta del staff, el espacio Acme de Ana, Bob invitado y dentro, un
segundo tablero. Nunca escribe filas a mano, así que todas las reglas se cumplen y todos
los eventos se publican como se publicarían.

```ts
// cooper/scripts/seed.ts
const contexts = await openContexts(config, { mailer: { send: async mail => { mails.push(mail); await console_.send(mail) } } })
/**
 * Until the background work is done: auth's jobs first, boards' reactions to auth's
 * events among them (Acme's welcome board), then what those made boards tell.
 */
const settled = async () => {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}

try {
  const { user, access, tenant, invitation } = contexts.auth.modules

  /** An account, made the first time. */
  const account = async (email: string, name: string) => (await user.findByEmail(email)) ?? user.signUp({ email, name, password: PASSWORD })

  const staff = await account('staff@cooper.dev', 'Cooper Staff')
  await access.admit({ userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' })
  // …
} finally {
  await stopContexts(contexts)
}
```

Tiene tres costumbres de un buen script:

- **Actúa como alguien.** Un caso de uso que necesita un actor se ejecuta dentro de
  `runAsActor` (`asAna(() => tenant.create({ name: 'Acme' }))`, donde `asAna` es
  `runAsActor({ userId: ana.id, via: 'web' }, fn)`: el seed hace lo que haría Ana en la
  aplicación web), y los casos de uso de boards además dentro del espacio de trabajo,
  con `inWorkspace`.
- **Espera a sus workers antes de cerrar**, con `jobs.idle()`, en el orden en que fluye
  el trabajo ([capítulo 25](./25-tests)). El email de la invitación de Bob lo manda un
  worker, y el seed lee de él el enlace.
- **Se puede ejecutar otra vez.** Mira antes de crear (`findByEmail`, `findByName`), así
  que una segunda vuelta deja lo que ya hay.

### `cooper:migrations`: migrar a mano

El backend migra cada contexto al abrirlo. `cooper:migrations` lo hace aparte, con el
backend parado: `status` enseña lo que cada contexto ha aplicado y lo que tiene
pendiente, `up` lo aplica, y `down --context <nombre>` revierte la última de ese
contexto (el [capítulo 24](./24-migrations) enseña el script).

```bash
bun run cooper:migrations status
```

Antes de un despliegue, `status` contra las bases de datos de producción te dice qué
migraciones aplicará la versión nueva al arrancar. Ejecutar antes `up`, por separado,
hace que una migración que falla falle ahí, en una orden que estás mirando, y no en el
arranque de un servidor.

### `cooper`: desarrollo

`dev.ts` arranca cuatro procesos: el backend (`bun --watch cooper/backend/index.ts`, que
se reinicia con cada cambio) y un servidor de Vite por frontend, que pasa las rutas de la
API al puerto de su contexto. Antes comprueba que todos los puertos estén libres, y lo
para todo si un proceso muere.

### `cooper:build`: los frontends para producción

Cada frontend se compila en `dist/cooper/<nombre>`. En producción no hay servidores de
Vite: cada contexto sirve su propio frontend compilado, en su propio puerto, para toda
dirección que no recojan sus rutas:

```ts
// cooper/backend/shared/served-context.ts
/** Its server: its modules' API, what it adds, and its frontend for any other address. */
serve(): Server<undefined> {
  return serve({ port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder })
}
```

Si la carpeta no tiene `index.html`, las páginas responden
`503 The frontend is not built`, y la API sigue funcionando.

## Arrancar y parar

El backend es un proceso con los tres contextos, cada uno servido en su puerto:

```ts
// cooper/backend/index.ts
// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

const servers = contexts.all.map(context => {
  const server = context.serve()
  console.log(`${context.name} listening on ${server.url}`)
  return server
})
for (const context of contexts.all) context.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
    process.exit(0)
  })
}
```

- **Al arrancar**: fija los mensajes de newt (más abajo); abre los contextos en orden
  (auth, boards, backoffice), cada uno aplicando sus migraciones; los sirve; arranca el
  worker de cada uno con `context.start()`.
- **Al parar**: primero deja de aceptar peticiones (`server.stop()`, que deja terminar
  las que están en marcha), y después para los contextos, el último que se abrió el
  primero:

```ts
// cooper/backend/open-contexts.ts
/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
```

`context.stop()` hace que su worker deje de reclamar jobs nuevos, espera a los que están
en marcha y cierra su store. Lo que quedaba pendiente sigue pendiente, en el outbox, y se
ejecuta cuando el backend vuelve.

Cada contexto responde `GET /api/health` sin sesión, para lo que vigile que está en pie.

### Los mensajes de newt, con las palabras de cooper

Algunos errores son de newt, no de un módulo: un conflicto, una referencia a nada, no
tener sesión, un cuerpo no válido, una ruta que no existe, un fallo por dentro. newt los
dice de forma llana y correcta ("Someone changed it in the meantime. Try again."), para
quien desarrolla. cooper los cambia por palabras para quien usa la aplicación, una vez,
para todo el proceso:

```ts
// cooper/backend/shared/messages.ts
export const cooperMessages: Partial<Messages> = {
  concurrency_conflict: () => 'Someone else changed this a moment ago. Reload it and try again.',
  reference_not_found: ({ resource, id }) => `That ${resource} is not there any more (${id})`,
  not_signed_in: () => 'Your session has ended: sign in again to go on',
  validation: () => 'Some of what was sent is not right: check the fields and try again',
  route_not_found: ({ method, path }) => `Cooper has nothing at ${method} ${path}`,
  internal: () => 'Something went wrong on our side. Try again in a moment.',
}

/**
 * Sets cooper's messages for the whole process: once, as the server starts
 * (`index.ts`), before any request. Every context answers with them.
 */
export function setCooperMessages(): void {
  setMessages(cooperMessages)
}
```

Solo cambia el mensaje. El `code` (`concurrency_conflict`) y el estado se quedan, así
que un cliente que actúa según el código no nota nada. Un mensaje que no aparece
conserva el de newt. Una aplicación en otro idioma hace lo mismo con sus palabras.
`index.ts` lo llama antes de abrir nada, así que ninguna respuesta sale antes con las
palabras de newt. Los tests, que no pasan por `index.ts`, leen los de newt; el que
comprueba los de cooper se ejecuta en un proceso propio ([capítulo 25](./25-tests)).

::: tip Consejo
Tras un despliegue, vigila en los logs `[JobQueue] N job(s) of '…' wait, and no worker
serves that queue`. newt avisa de una cola con jobs que ningún worker atiende desde hace
cinco minutos. Casi siempre es que se ha renombrado un handler, un caso de uso o un
módulo, y los jobs viejos esperan con el nombre antiguo ([capítulo 11](./11-reacting)).
:::

## Configuración

Todo sale de variables de entorno, leídas una vez en `cooper/backend/config.ts`, con
valores por defecto para desarrollo. Bun carga solo un fichero `.env`.

| Variable | Por defecto | Qué es |
|---|---|---|
| `COOPER_AUTH_PORT` | `3001` | Dónde escucha auth. |
| `COOPER_BOARDS_PORT` | `3002` | Dónde escucha boards. |
| `COOPER_BACKOFFICE_PORT` | `3003` | Dónde escucha el backoffice. |
| `COOPER_AUTH_DB_PATH` | `data/cooper-auth.db` | El fichero de base de datos de auth. |
| `COOPER_BOARDS_DB_PATH` | `data/cooper-boards.db` | El de boards. |
| `COOPER_BACKOFFICE_DB_PATH` | `data/cooper-backoffice.db` | El del backoffice. |
| `COOPER_AUTH_PUBLIC_URL` | `http://localhost:5171` | Dónde abre la gente auth. |
| `COOPER_BOARDS_PUBLIC_URL` | `http://localhost:5172` | Dónde abre la gente boards. |
| `COOPER_BACKOFFICE_PUBLIC_URL` | `http://localhost:5173` | Dónde abre la gente el backoffice. |
| `COOPER_BOARDS_CLIENT_SECRET` | un secreto de desarrollo | El secreto del cliente OAuth de boards. |
| `COOPER_BACKOFFICE_CLIENT_SECRET` | un secreto de desarrollo | El del cliente OAuth del backoffice. |
| `COOPER_SESSION_DAYS` | `30` | Cuánto dura una sesión del navegador, en todos los contextos. |
| `COOPER_INVITATION_DAYS` | `7` | Cuánto espera una invitación a que la acepten. |
| `COOPER_OAUTH_ACCESS_MINUTES` | `60` | Cuánto dura un access token. |
| `COOPER_OAUTH_REFRESH_DAYS` | `30` | Cuánto dura un refresh token sin usar. |
| `COOPER_MAIL_FROM` | `cooper <no-reply@cooper.local>` | De quién vienen los emails. |
| `COOPER_AUTH_FRONTEND` | `dist/cooper/auth` | El frontend compilado de auth. |
| `COOPER_BOARDS_FRONTEND` | `dist/cooper/boards` | El de boards. |
| `COOPER_BACKOFFICE_FRONTEND` | `dist/cooper/backoffice` | El del backoffice. |
| `COOPER_TRACE` | apagado | `1` escribe en la consola cada caso de uso de todos los contextos, con los que llama, en una sola traza, y una línea cada vez que se mueve una card ([capítulo 22](./22-backoffice)). |

Las rutas relativas lo son a la raíz del repositorio. En desarrollo, las URLs públicas
son los servidores de Vite; en producción, el dominio de cada contexto, delante de su
puerto. Con un dominio por contexto, además, cada uno se queda con sus cookies.

::: warning Cuidado
Los secretos de los clientes tienen valores de desarrollo para que cooper arranque sin
configurar nada. En producción, pon los dos: con los de por defecto, cualquiera que haya
leído esta página podría hacerse pasar por boards ante el endpoint de tokens de auth.
:::

El mailer es lo único que no es una variable: `openContexts` lo recibe como opción, y usa
`ConsoleMailer` (los emails, a la consola) si no le das ninguno. Uno de verdad (SMTP, una
API de email) es cualquier objeto con el mismo `send(mail)`: el tipo `Mailer`, en
`shared/mail/mailer.ts`.

## Varios procesos sobre los mismos datos

Un servidor y un script pueden trabajar a la vez sobre la misma base de datos: lanzas el
seed, o un script que corrige datos, con el backend en marcha. ¿Qué pasa entonces?

- **Las transacciones se turnan entre procesos.** SQLite deja escribir a un proceso cada
  vez. El otro espera, hasta **5 segundos**, y después falla con `database is locked`.
  Eso no es un `ConcurrencyConflict`, así que ningún caso de uso lo reintenta. Un script
  con una transacción larga hace fallar las peticiones del servidor que esperan tras
  ella: haz los scripts en transacciones cortas, una por fila o por lote pequeño.
- **Los jobs se comparten.** El outbox está en la base de datos, así que el worker del
  servidor y el `jobs.idle()` de un script sacan jobs de la misma cola. Cada job lo
  reclama uno de los dos, con un plazo, y solo lo cierra quien lo reclamó. Un job nunca
  se ejecuta dos veces a la vez. Pero puede ejecutarse en el **otro** proceso.

Esto último importa para el seed. Lee el enlace de la invitación de Bob de los emails que
recibió **su** mailer. Si el worker del servidor reclama antes ese job, el email sale del
servidor, y el seed no lo encuentra. Ejecuta el seed con el backend parado.

## Elegir otro store

cooper funciona sobre SQLite: un fichero por contexto, nada que instalar, transacciones
de una en una. Es un buen sitio para empezar, y una sola máquina llega lejos con él.
Cuando necesites varios servidores sobre los mismos datos, o muchas escrituras a la vez,
newt también trae `PostgresStore` y `MySqlStore` (`newt/adapter-postgres`,
`newt/adapter-mysql`), que se abren con una URL:

```ts
// packages/newt/adapter-postgres/postgres-store.ts
static async open(options: SqlStoreOptions): Promise<PostgresStore> {
```

Los módulos no cambiarían. Esto es lo que sí cambiaría en cooper (la
[referencia de stores](../reference/stores) tiene todos los detalles):

- **Abrir el store.** El `open` de cada contexto llama a `SqliteStore.open(…)`; llamaría
  a `PostgresStore.open({ url, migrations })`. `CooperBase` dice `Base<SqliteStore>`,
  así que su tipo cambia con él.
- **Las migraciones**, reescritas en el nuevo dialecto, en su propia carpeta, con los
  mismos pares de ficheros. En Postgres, las columnas de texto mejor con
  `COLLATE "C"`, para que el texto se ordene y se compare por punto de código, como en
  SQLite; los booleanos son `BOOLEAN` y el JSON, `JSONB`. El índice único de boards sobre
  `lower(name)` vale tal cual. En MySQL, los ids son `VARCHAR(36)`, las columnas de texto
  `utf8mb4_0900_bin`, y un valor único entre las filas no borradas es un índice
  funcional sobre `IF(deleted_at IS NULL, …, NULL)`.
- **Las transacciones van a la vez.** Aquí es donde se ganan el sueldo las claves de
  `guard` de los guardados de cooper: las cards de un tablero y su contador
  (`boardCards:<board>`), las cards de una columna (`cards:<column>`), las columnas de un
  tablero (`columns:<board>`), el nombre de un tablero (`boardName:<workspace>:<name>`),
  el acceso de una persona (`access:<user>:<product>:<tenant>`), el admin de un espacio
  (`tenantAdmin:<tenant>`), la cuenta de un email
  (`userEmail:<email>`). En SQLite cada guardado espera su turno de todos modos, así que
  un `guard` que falta pasa desapercibido. En Postgres y MySQL cada `guard` es un bloqueo
  en la base de datos, y un guardado sin él rompe su regla sin hacer ruido. Un
  *deadlock* se convierte en un `ConcurrencyConflict`, y el caso de uso se repite.
- **Los recuentos con Kysely valen tal cual.** Ya pasan por `Number(…)`, que es lo que
  necesita un `COUNT` de Postgres.
- **Lo marcado como de SQLite** es lo que hay que reescribir. `SqliteAnalytics` usa la
  conexión de SQLite y `json_extract`. En otro store sería otro adaptador del puerto de
  analítica, o una base de datos analítica de verdad (DuckDB, ClickHouse).
- **Ficheros no es una opción** para boards: su base usa Kysely, que necesita un store
  SQL.

`ieq` compara igual en todos los stores: de la A a la Z, sin importar mayúsculas. `Ñ` y
`ñ` son distintas en SQLite, en Postgres y en MySQL.

## En resumen

- Los scripts abren los contextos como el servidor, actúan con casos de uso dentro de
  `runAsActor` y esperan a sus workers con `jobs.idle()` antes de cerrar.
- Las migraciones se pueden mirar y aplicar aparte, antes de un despliegue:
  `bun run cooper:migrations status|up|down`.
- Arrancar: fijar los mensajes de newt, abrir los contextos en orden, servir, arrancar
  los workers. Parar: dejar de servir y después parar los contextos, el último abierto
  el primero. Los jobs pendientes esperan al siguiente arranque.
- Los mensajes de newt se cambian una vez, para todo el proceso, con `setMessages`; los
  códigos se quedan.
- La configuración sale del entorno, con valores de desarrollo. En producción, pon los
  secretos.
- Varios procesos comparten la base de datos y su outbox. Haz cortas las transacciones de
  un script; un job puede ejecutarse en cualquiera de los dos procesos.
- Otro store cambia cómo se abre, las migraciones y todo lo marcado como de SQLite. Los
  módulos se quedan. Las claves de `guard` empiezan a importar.
