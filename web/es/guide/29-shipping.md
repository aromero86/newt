# Ponerlo en producción

Queda un último trozo de código, y trata de detenerse. Cuando un despliegue le dice a
cooper que se detenga, cada servidor debería seguir respondiendo un momento, diciendo
que se está deteniendo, para que quien reparte la carga delante de él no le envíe nada
nuevo antes de que cierre. Es una opción de configuración y una línea, más abajo, en
[Arrancar y detener](#arrancar-y-detener). Con ella, tu árbol es cooper: los mismos
contextos, módulos, migraciones, tests y scripts que el `cooper/` del repositorio. El
último punto de control, `tutorial/29`, es el código del repositorio, y

```sh
git diff tutorial/29 main -- cooper eslint.config.js 'tsconfig*.json' package.json bun.lock
```

no imprime nada.

El resto del capítulo trata de ponerlo delante de la gente: el test de extremo a
extremo que dice que cooper funciona como un todo, el build, la configuración, cómo
arranca y cómo se detiene, el lint como lista de comprobación, y las reglas que enseñó
la guía, en un solo sitio.

## cooper, de extremo a extremo

Cada capítulo añadió sus tests junto a su código: los casos de uso de un módulo, un
contexto sobre HTTP, el contrato de un puerto. Un fichero prueba cooper como un todo,
como lo usa la gente: `cooper/backend/cooper.test.ts`. Abre los tres contextos como los
abre el servidor (`openContexts`, SQLite en memoria), sirve auth y boards en puertos
libres, y los maneja por HTTP con el `browser()` de `newt/testing` (capítulo
[22](./22-web-session)), como lo haría la UI de boards:

- **`signUp`** pasa por el inicio de sesión real: el `/api/session/sign-in` de boards,
  el registro y el consentimiento de auth, y de vuelta al callback de boards con una
  cookie de sesión.
- **Espacios de trabajo, a través de boards**: un espacio de trabajo nuevo recibe su
  tablero de bienvenida un momento después (el evento de auth, el worker de boards,
  capítulo [20](./20-wiring-contexts)); una invitación la acepta quien tiene su email,
  leído del correo que envió el worker (capítulo [19](./19-invitations-and-time)); quien
  es eliminado deja sus tarjetas sin asignar; un espacio de trabajo borrado pierde sus
  tableros, y nadie entra en él (capítulo [14](./14-sagas)).
- **El servidor MCP**: un cliente conectado por OAuth trabaja con los tableros de su
  persona, y una petición sin token se rechaza diciendo dónde conseguir uno (capítulo
  [24](./24-mcp-server)).

"Un momento después" es `settled()`: los jobs de auth, luego los de boards, se ejecutan
hasta quedar ociosos, en el orden en que fluye el trabajo.

```sh
bun test cooper/backend/cooper.test.ts
```

```text
 6 pass
 0 fail
 80 expect() calls
Ran 6 tests across 1 file.
```

Y toda la comprobación, una vez más:

```sh
bun install && bun check && bun test cooper && bun run lint && bun run cooper:build
```

```text
 169 pass
 0 fail
 622 expect() calls
Ran 169 tests across 29 files.
```

Con `COOPER_TEST_POSTGRES_URL` definida (capítulo [27](./27-postgres)), se ejecutan cinco
más sobre Postgres.

## Construir los frontends

En desarrollo, `bun run cooper` arranca el backend y un servidor Vite por frontend, que
reenvía las direcciones de la API a su contexto (capítulo [23](./23-frontends)). En
producción no hay Vite. Construye las tres apps una vez:

```sh
bun run cooper:build
```

Cada una acaba en `dist/cooper/<name>`: `auth`, `boards`, `backoffice`. Cada contexto
sirve la suya, en su propio puerto, para toda dirección que sus rutas no atienden:

```ts
// cooper/backend/shared/served-context.ts
  /** How it is served (`runContexts`, `serve`): its modules' API, what it adds, its health, and its frontend for any other address. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder, health: true }
  }
```

El `serve` de newt responde con el fichero a una ruta que nombra un fichero de la
carpeta, y con `index.html` a cualquier otra, de modo que el router de la app muestra
su página (o su propio "no encontrado"). Toda página HTML se niega a que la enmarquen
(`X-Frame-Options: DENY`), así que ningún otro sitio puede esconder la página de
consentimiento de auth en un marco y robar el clic. Una carpeta sin `index.html`
responde `503 The frontend is not built`, y la API funciona igual.

```sh
bun cooper/backend/index.ts
curl -s -i localhost:3002/ | head -3
```

```text
HTTP/1.1 200 OK
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
```

## La configuración

Todo viene de variables de entorno, leídas una sola vez en `cooper/backend/config.ts`,
con lo que necesita el desarrollo por defecto. Bun carga un fichero `.env` por sí solo.

| Variable | Por defecto | Qué es |
|---|---|---|
| `COOPER_AUTH_PORT` | `3001` | Dónde escucha auth. |
| `COOPER_BOARDS_PORT` | `3002` | Dónde escucha boards. |
| `COOPER_BACKOFFICE_PORT` | `3003` | Dónde escucha el backoffice. |
| `COOPER_AUTH_DATABASE` | `data/cooper-auth.db` | La base de datos de auth: un fichero SQLite, o una dirección `postgres://`. |
| `COOPER_BOARDS_DATABASE` | `data/cooper-boards.db` | La base de datos de boards, igual. |
| `COOPER_BACKOFFICE_DATABASE` | `data/cooper-backoffice.db` | La base de datos del backoffice, igual. |
| `COOPER_AUTH_PUBLIC_URL` | `http://localhost:5171` | Dónde abre la gente auth. |
| `COOPER_BOARDS_PUBLIC_URL` | `http://localhost:5172` | Dónde abre la gente boards. |
| `COOPER_BACKOFFICE_PUBLIC_URL` | `http://localhost:5173` | Dónde abre la gente el backoffice. |
| `COOPER_BOARDS_CLIENT_SECRET` | un secreto de desarrollo | El secreto de cliente OAuth de boards. |
| `COOPER_BACKOFFICE_CLIENT_SECRET` | un secreto de desarrollo | El secreto de cliente OAuth del backoffice. |
| `COOPER_AUTH_FRONTEND` | `dist/cooper/auth` | El frontend construido de auth. |
| `COOPER_BOARDS_FRONTEND` | `dist/cooper/boards` | El frontend construido de boards. |
| `COOPER_BACKOFFICE_FRONTEND` | `dist/cooper/backoffice` | El frontend construido del backoffice. |
| `COOPER_SESSION_DAYS` | `30` | Cuánto dura una sesión del navegador, en todos los contextos. |
| `COOPER_INVITATION_DAYS` | `7` | Cuánto espera una invitación a ser aceptada. |
| `COOPER_OAUTH_ACCESS_MINUTES` | `60` | Cuánto dura un token de acceso. |
| `COOPER_OAUTH_REFRESH_DAYS` | `30` | Cuánto dura un token de refresco sin usar. |
| `COOPER_MAIL_FROM` | `cooper <no-reply@cooper.local>` | De quién vienen los correos. |
| `COOPER_TRACE` | apagado | `1` escribe cada traza en la consola, y cada movimiento de tarjeta. |
| `COOPER_OTLP_URL` | ninguna | Un colector de OpenTelemetry al que van las trazas en su lugar. |
| `COOPER_DRAIN_MS` | `2000` | Cuánto sigue respondiendo cada servidor una vez se le dice que se detenga. |

Las rutas relativas son relativas a la raíz del repositorio. Los tests leen una más,
`COOPER_TEST_POSTGRES_URL`, y nada más la lee.

En desarrollo las URL públicas son los servidores Vite. En producción cada una es el
dominio propio del contexto, delante de su puerto: `auth.example.com` al 3001, y así
sucesivamente. Las URL públicas son lo que auth pone en sus metadatos OAuth y en sus
redirect URIs, y para lo que son los tokens (capítulo [24](./24-mcp-server)), así que
deben ser las direcciones que la gente abre de verdad. Además, cada contexto en su
propio dominio guarda sus cookies para sí (capítulo [22](./22-web-session)).

::: warning
Los secretos de cliente tienen valores de desarrollo por defecto para que cooper
funcione sin configurar nada. En producción, define los dos: con los valores por
defecto, cualquiera que haya leído esta guía podría actuar como boards en el endpoint
de tokens de auth.
:::

El mailer es la única dependencia que no es una variable: `openContexts` lo recibe como
opción y usa el `ConsoleMailer` cuando no se le da ninguno (capítulo
[12](./12-failures)). Uno real, SMTP o una API de correo, es cualquier objeto con el
mismo `send(mail)`.

## Arrancar y detener

El backend es un solo proceso, `bun cooper/backend/index.ts`. Su última opción es
cuánto drena un servidor al detenerse. Añádela a `config.ts`, después de `trace`:

```ts
// cooper/backend/config.ts
// …
  trace: env.COOPER_TRACE === '1',
  /**
   * `COOPER_DRAIN_MS`: how long each server goes on answering once told to stop, its
   * health a 503 meanwhile, so whoever balances the load sends it nothing new: 2
   * seconds. Only the backend's process drains: a test stops its servers at once.
   */
  drainMs: Number(env.COOPER_DRAIN_MS ?? 2000),
// …
```

y sirve cada contexto con ella, en `index.ts`:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { config } from './config'
import { cooperTracer, openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

// One tracer for every context: a request, and the use cases it calls in any context, is one trace.
// Stopping, each server's health answers 503 for a moment before it closes.
const app = runContexts(contexts.all.map(context => ({ context, serve: { ...context.serving(), drainMs: config.drainMs } })), { tracer: cooperTracer(config) })
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)
```

**Antes de arrancar**, aplica las migraciones por separado, con el código de la versión
nueva y la configuración de producción (capítulo [27](./27-postgres)):

```sh
bun run cooper:migrations status
bun run cooper:migrations up
```

El servidor las aplicaría de todos modos al abrir cada contexto. Hacerlo antes consigue
que una migración que falla falle en un comando que estás mirando, no en el arranque de
tres servidores.

**Arrancar**: se fijan los mensajes de cooper; los contextos se abren en orden (auth,
boards, backoffice), con el store de cada uno puesto al día; `runContexts` fija el
tracer, sirve cada contexto y después arranca el worker de cada uno.

**Salud**: cada contexto responde `GET /api/health` sin sesión (capítulo
[1](./01-project-and-context)): `200 {"status":"ok"}` mientras sirve. Apunta tu
balanceador de carga u orquestador a ella, una comprobación por contexto.

**Detener**, con SIGINT o SIGTERM (lo que envía un despliegue):

1. Cada servidor drena, y después deja de aceptar peticiones. Su health responde
   `503 {"status":"stopping"}` desde ese momento. Durante `drainMs` sigue respondiendo
   todo lo demás como antes, así que un balanceador que consulta el health ve el 503 y
   lleva las peticiones nuevas a otra instancia mientras esta aún responde las que ya
   venían de camino. Después cierra, y las peticiones en curso terminan.
2. Cada contexto se detiene, el último abierto primero, de modo que ninguno se detiene
   antes que uno que lo usa: su worker deja de reclamar jobs, espera a los que están en
   curso, y su store se cierra.
3. El tracer envía lo que aún guarda (`flush`).

`serving()` no da `drainMs`, así que los tests, que abren los contextos y los sirven
igual, detienen sus servidores en el acto; solo `index.ts` lo añade. Pruébalo con un
drenaje más largo:

```sh
COOPER_DRAIN_MS=3000 bun cooper/backend/index.ts
```

Desde otra terminal, envíale SIGTERM (`kill -TERM <su pid>`) y pide su health dentro
de esos tres segundos:

```sh
curl -s -i localhost:3002/api/health
```

```text
HTTP/1.1 503 Service Unavailable
…
{"status":"stopping"}
```

Tres segundos después los servidores están cerrados, y el mismo `curl` no encuentra a
nadie.

Lo que estaba pendiente sigue pendiente, en el outbox, y se ejecuta cuando cooper
vuelve: un job se escribe en la misma transacción que el cambio que lo originó
(capítulo [11](./11-reacting)), así que no se pierde nada entre una cosa y otra.

Después de un despliegue, mira en los logs si aparece `[JobQueue] N job(s) of '…' wait,
and no worker serves that queue: was its handler renamed or removed?`. Casi siempre
significa que se renombró un handler, un caso de uso o un módulo, y los jobs antiguos
esperan bajo el nombre antiguo (capítulo [11](./11-reacting)). Los jobs que fallaron
definitivamente se listan, y se ejecutan de nuevo, en el backoffice (capítulo
[26](./26-dead-jobs-and-analytics)).

### Un proceso, por ahora

cooper tal como está corre como **un** proceso. Las bases de datos admitirían más:
SQLite turna a los escritores de varios procesos, Postgres los deja en paralelo, y el
outbox entrega cada job a un worker, esté en el proceso que esté. Lo que no admite más
es la búsqueda de tarjetas de boards: `MemoryCardSearch` vive en la memoria del proceso
(capítulo [16](./16-search-port)). Con dos procesos, cada uno indexaría solo las
tarjetas cuyos jobs ejecutó su propio worker. Antes de ejecutar boards dos veces, dale
al puerto de búsqueda un adaptador fuera del proceso (Elasticsearch, el texto completo
de Postgres), comprobado con el mismo `describeCardSearchContract`. Nada más cambia:
para eso estaba el puerto.

## El lint, como lista de comprobación

`bun run lint` hace que todo módulo tenga la misma forma y que todo contexto se quede
dentro de sus fronteras. Antes de que entre un cambio, comprueba lo que de otro modo
comprobarías a ojo:

- [ ] **`newt/module-anatomy`**: el módulo tiene los ficheros que tiene todo módulo,
  con su nombre (`<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`,
  `<m>.routes.ts`, `<m>.workers.ts`…), y sus eventos son `<m>-<event>.ts` (capítulo
  [2](./02-first-module)).
- [ ] **`newt/module-boundaries`**: un módulo importa de otro solo su módulo, schema,
  eventos, errores y objetos de valor; nunca su entidad, repositorio, rutas ni workers.
- [ ] **`newt/schema-imports`**: el `<m>.schema.ts` de un módulo toma de newt solo
  `newt/contract`, porque lo importa un frontend (capítulo [23](./23-frontends)).
- [ ] **`newt/queue-name`**: la cola de un handler es
  `<module>.<use case>.on.<module>.<event>`, y su callback llama a ese caso de uso
  (capítulo [11](./11-reacting)).
- [ ] **`newt/context-boundaries`**: un contexto importa solo los que nombra su `uses`:
  auth ninguno, boards auth, el backoffice los dos (capítulo [20](./20-wiring-contexts)).
- [ ] **Ningún `transaction` en un módulo**: un módulo escribe a través del `save` o
  `saveRows` de su repositorio (capítulo [6](./06-rules-over-rows)).
- [ ] **Ninguna promesa sin esperar** (`@typescript-eslint/no-floating-promises`).
- [ ] **Los frontends**: ni nombres de clase ni estilos en línea fuera de `@cooper/ui`
  y de los `components/` de una app, y nunca un import del backend salvo el
  `*.schema.ts` de un módulo, desde `@cooper/api` (capítulo [23](./23-frontends)).

Lo que el lint no puede ver, lo comprueba newt mientras se ejecuta: un guardado que lee
filas y no protege nada (la regla del guard), una escritura en otro módulo fuera de un
worker, o dos módulos guardados en una transacción, también en un worker (la regla de
escritura, salvo que `writesTo` lo diga), una cola cuyo nombre no coincide con su
suscripción. Y el compilador: un guardado con `after` y sin `guard` no
compila.

## Las reglas, una vez más

Lo que enseñaron los capítulos, en el orden en que lo fuiste viendo. El apéndice
[A](./a-golden-rules) tiene las mismas reglas en una sola página.

**Un módulo.**

- Un módulo, una responsabilidad, y siempre los mismos ficheros (capítulo
  [2](./02-first-module)).
- El schema es el contrato: las entradas tienen solo lo que envía un cliente; un objeto
  de valor guarda en un solo sitio las reglas de un valor (capítulo
  [2](./02-first-module)).
- Solo la entidad se cambia a sí misma; solo el repositorio toca el store; una ruta no
  piensa (capítulo [2](./02-first-module)).
- Una ruta nunca captura: lo que lanza un caso de uso se convierte en `{ error, code }`
  con su estado, y un cliente actúa según `code` (capítulo
  [3](./03-pages-and-errors)).
- Ninguna lista se devuelve entera salvo que una regla del dominio la acote; todas las
  demás van por páginas (capítulo [3](./03-pages-and-errors)).
- Quién es el actor, nunca un id pasado a mano; si puede se pregunta cada vez; dónde es
  un ámbito (capítulo [4](./04-who-and-where)).

**Los datos y sus reglas.**

- El store es un puerto; lo elige el contexto, los módulos nunca lo saben (capítulos
  [5](./05-sqlite) y [27](./27-postgres)).
- Una migración aplicada no cambia nunca; un cambio es una nueva, en cada dialecto
  (capítulos [5](./05-sqlite), [18](./18-tenants-and-access) y [27](./27-postgres)).
- Una versión protege una fila; una regla sobre varias filas se comprueba en el `after`
  del guardado, bajo un `guard` tan estrecho como la regla (capítulo
  [6](./06-rules-over-rows)).
- Un valor que todos cambian a la vez vive en una fila propia, tomada en `before` bajo
  un guard; un índice único tiene la última palabra (capítulo
  [7](./07-cards-and-a-counter)).
- Un conflicto ejecuta el caso de uso otra vez, desde el principio (capítulo
  [8](./08-two-people-one-card)).
- Un POST que crea se hace seguro de enviar dos veces con un `Idempotency-Key`
  (capítulo [9](./09-idempotent-posts)).
- Lo que una tabla no puede decir es Kysely, y Kysely no conoce el ámbito: escribe tú
  el `where` del espacio de trabajo (capítulo [15](./15-kysely)).
- El tiempo es una dependencia: pide `now()`, y un test controla el reloj (capítulo
  [19](./19-invitations-and-time)).
- Guarda un hash, nunca el secreto (capítulo [17](./17-auth)).

**Eventos y workers.**

- Un evento es algo que ocurrió, anotado por la entidad y publicado cuando el guardado
  confirma (capítulo [10](./10-events)).
- Una reacción es un job en el outbox, escrito en la misma transacción; se ejecuta al
  menos una vez, así que no debe importar que se ejecute dos (capítulo
  [11](./11-reacting)).
- Lo que no se puede deshacer sale de un worker, que vuelve a leer antes de actuar, y
  con una clave del evento de su job, para que enviado dos veces salga una (capítulo
  [12](./12-failures)).
- Un módulo que sigue a otro reacciona también a sus propios eventos: cada seguidor se
  ejecuta después de su propio commit y mira el otro lado, así que el que corre el
  último ve los dos (capítulo [13](./13-another-context)).
- Un caso de uso escribe en otro módulo solo desde un worker; la excepción lo dice con
  `writesTo` (capítulos [8](./08-two-people-one-card) y [17](./17-auth)).
- El trabajo sobre varios módulos es una saga de pasos que encuentran cada uno lo que
  hizo una ejecución anterior (capítulo [14](./14-sagas)).
- Una proyección va un momento por detrás; lee las filas reales después de ella
  (capítulo [16](./16-search-port)).

**Contextos.**

- Un contexto es su propia base de datos, módulos y migraciones; lo que necesita de otro
  es un puerto en sus propias palabras (capítulos [13](./13-another-context) y
  [17](./17-auth)).
- Las escrituras en otro contexto empiezan en un punto de entrada, nunca en un caso de
  uso tuyo (capítulo [20](./20-wiring-contexts)).
- Un tercer contexto lee a los otros solo a través de sus casos de uso (capítulo
  [25](./25-backoffice)).

**Puertas.**

- Las direcciones con un formato propio tienen un router propio, y su propio `onError`
  (capítulos [21](./21-oauth-server) y [24](./24-mcp-server)).
- El navegador guarda solo la cookie de sesión de su contexto; el servidor hace el OAuth
  (capítulo [22](./22-web-session)).
- Los frontends comparten el contrato (`newt/contract`, el `*.schema.ts` de un módulo),
  nunca el código (capítulo [23](./23-frontends)).
- Un servidor MCP es otra puerta a los mismos casos de uso; `via` dice cómo entró
  alguien, nunca qué puede hacer (capítulo [24](./24-mcp-server)).

**Ponerlo en marcha.**

- El outbox se ve desde fuera: los jobs muertos se listan y se ejecutan de nuevo desde
  el backoffice (capítulo [26](./26-dead-jobs-and-analytics)).
- Un tracer para todo el proceso; newt hace los spans (capítulo
  [28](./28-observability)).
- Migra antes de arrancar; drena y deja de servir antes de detener los contextos
  (este capítulo).

## El final

Has construido cooper: tres contextos, veinte módulos, un servidor OAuth, dos apps web
y una consola, un servidor MCP, sobre SQLite o Postgres, con trazas. Cada regla de
arriba está en algún sitio de ese código, y la mayoría las comprueban por ti el
compilador, el lint o newt mientras se ejecuta.

A partir de aquí, los apéndices son para consultar:
[A. Las reglas de oro](./a-golden-rules), [B. Anatomía de un módulo y lint](./b-module-anatomy),
[C. Problemas comunes](./c-common-problems), [D. Escribir un store](./d-writing-a-store),
y [E. Índice](./e-index), que dice qué capítulo enseña cada export de newt.
La [referencia](../reference/rules) tiene cada detalle que los capítulos dejaron fuera.
