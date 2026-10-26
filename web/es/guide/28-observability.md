# Observabilidad

Una petición a cooper rara vez se queda en un solo sitio. Registrarse en auth ejecuta
`session.signUp`, que ejecuta `user.signUp`; un momento después el worker del
backoffice registra el alta. Abrir el backoffice ejecuta `staff.me`, que le pregunta a
auth si eres del personal. Cuando una de ellas es lenta, o falla, quieres verla entera:
qué llamó a qué, en qué contexto y cuánto tardó cada una.

Eso es una **traza** (trace): un árbol de **spans**, uno por cada cosa que se ejecutó,
cada uno dentro del que lo llamó. newt arranca los spans por ti, alrededor de cada
petición y de cada caso de uso. Lo que te deja a ti es adónde van. En este capítulo
cooper los envía a la consola, o a un colector de OpenTelemetry, y una petición que
cruza contextos es una sola traza.

Lo que añades:

```text
cooper/backend/
  config.ts                                  changed: trace, otlpUrl
  shared/observability/console-tracer.ts     new: cooper's ConsoleTracer
  shared/observability/console-tracer.test.ts new
  open-contexts.ts                           changed: cooperTracer; boards' log only while tracing
  index.ts                                   changed: runContexts with the tracer
  open-contexts.test.ts                      changed: two tests of the tracer
  postgres.test.ts                           changed: trace: false
  contexts/backoffice/testing/open-test-backoffice.ts  changed: trace: false
  contexts/backoffice/backoffice-sign-in.test.ts       changed: trace: false
```

## Tracer y Span

El tracing de newt son dos interfaces pequeñas en `newt/core`. Un **`Tracer`** ejecuta
una función dentro de un span:

```ts
// packages/newt/core/observability/tracer.ts
export interface Tracer {
  startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T>
  /** Sends the spans it still keeps, for one that sends them in batches: once the application stops. */
  flush?(): Promise<void>
}
```

El span está **activo** mientras `fn` se ejecuta: un span que empieza dentro de ella, por
profundo que esté en las llamadas, es su hijo. Llevar la cuenta de cuál es el span
activo es trabajo del tracer. Un **`Span`** es lo que recibe `fn` para anotar lo que
pasó:

```ts
// packages/newt/core/observability/span.ts
export interface Span {
  setError(error: unknown): void
  /** Something worth noting that happened during the span, with what describes it. */
  addEvent(name: string, attributes: SpanAttributes): void
  end(): void
}
```

Los `SpanAttributes` son lo que describe un span: `Record<string, string | number |
boolean>`.

Son las mismas formas que las de OpenTelemetry, a propósito: cualquier APM puede
colocarse detrás. No las llamas en un módulo. Las llama newt:

- **Cada caso de uso** es un span, con el nombre del caso de uso (`user.signUp`), y
  `{ context, module, useCase }` como atributos. Uno llamado desde dentro de otro, en el
  mismo contexto o en otro, es su hijo. Un error que no es un error de dominio (un
  `DomainError` es una respuesta, no un fallo) marca el span con `setError`. Un
  conflicto que ejecuta de nuevo el caso de uso es un evento de su span,
  `conflict.retry`, con el intento.
- **Cada petición** que responde un router es un span, `POST /api/session/sign-up`, con
  `http.method` y `http.route`. Es la raíz de la traza de la petición: los casos de uso
  que llama su ruta están dentro. Una respuesta 5xx lo marca como error.
- **Los jobs**: lo que hace un job es un caso de uso (un handler llama a uno, capítulo
  [11](./11-reacting)), así que es un span propio, la raíz de su traza, ya que el worker
  lo ejecuta aparte de la petición que escribió el job. El tick de un schedule es
  `schedule.tick`. Las tareas de mantenimiento del worker también son spans: `job.claim`
  cada pocos segundos, `job.renew`, `job.close`, `job.seen`, `job.purge`.

Hasta que alguien le da un tracer a newt, todos los spans van a un `NoopTracer`, que
ejecuta la función y no anota nada.

## Un tracer propio de cooper: la consola

Para leer trazas mientras desarrollas, cooper escribe cada una en la consola cuando
termina, con sangría según la profundidad y con su tiempo. Eso es un `Tracer` de unas
pocas líneas, en una carpeta nueva, `shared/observability`:

```ts
// cooper/backend/shared/observability/console-tracer.ts
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span, SpanAttributes, Tracer } from 'newt/core'

/** A span as it is kept until its trace is written: what it was, how long, and what it called. */
type TracedSpan = {
  name: string
  attributes: SpanAttributes
  started: number
  ms: number
  error: string | null
  events: string[]
  children: TracedSpan[]
}

/** Where a line goes: the console, or a list in a test. */
export type TraceWriter = (line: string) => void

/**
 * A tracer that writes each trace to the console once it ends: the use case called
 * from outside, with the ones it called inside it, how long each took, a conflict
 * retried and an error that is not a domain one. It is newt's `Tracer`, the same an
 * OpenTelemetry exporter implements: the application's one (`setTracer`), for every
 * context.
 */
export class ConsoleTracer implements Tracer {

  /** The span running now, which a span started inside it is a child of. */
  private readonly active = new AsyncLocalStorage<TracedSpan>()

  constructor(private readonly write: TraceWriter = line => console.log(line)) {}

  async startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    const parent = this.active.getStore()
    const traced: TracedSpan = { name, attributes, started: performance.now(), ms: 0, error: null, events: [], children: [] }
    parent?.children.push(traced)
    const span: Span = {
      setError: error => { traced.error = error instanceof Error ? error.message : String(error) },
      addEvent: (event, eventAttributes) => { traced.events.push(`${event} ${JSON.stringify(eventAttributes)}`) },
      end: () => { traced.ms = performance.now() - traced.started },
    }
    try {
      return await this.active.run(traced, () => fn(span))
    } finally {
      if (traced.ms === 0) span.end()
      // A trace is written whole, once the span that began it ends.
      if (!parent) this.print(traced, 0)
    }
  }

  private print(traced: TracedSpan, depth: number): void {
    const where = traced.attributes.context ? `${traced.attributes.context} ` : ''
    const notes = [...traced.events, ...(traced.error ? [`error: ${traced.error}`] : [])]
    this.write(`[trace] ${'  '.repeat(depth)}${where}${traced.name} ${traced.ms.toFixed(1)} ms${notes.length ? ` (${notes.join('; ')})` : ''}`)
    for (const child of traced.children) this.print(child, depth + 1)
  }
}
```

- **`AsyncLocalStorage`** guarda el span activo. `active.run(traced, …)` lo convierte en
  el activo para todo lo que `fn` espere con `await`, así que un span que empieza en
  cualquier punto de dentro encuentra a su padre con `getStore()`.
- **Una traza se escribe entera, cuando termina su raíz.** Los spans de peticiones
  distintas se ejecutan a la vez; imprimir cada uno al terminar los entremezclaría. La
  raíz guarda a sus hijos, y `print` recorre el árbol.
- **El escritor es una función**, `console.log` por defecto, para que su test lea las
  líneas.

Su test:

```ts
// cooper/backend/shared/observability/console-tracer.test.ts
import { describe, expect, test } from 'bun:test'
import { ConsoleTracer } from './console-tracer'

describe('ConsoleTracer', () => {
  test('writes a trace whole once it ends: each span inside the one that called it', async () => {
    const lines: string[] = []
    const tracer = new ConsoleTracer(line => lines.push(line))

    const answer = await tracer.startActiveSpan('workspace.get', { context: 'backoffice' }, async () => {
      await tracer.startActiveSpan('staff.enter', { context: 'backoffice' }, async span => {
        span.addEvent('conflict.retry', { attempt: 1 })
      })
      await tracer.startActiveSpan('broken', {}, async span => span.setError(new Error('disk full'))).catch(() => {})
      return 42
    })

    expect(answer).toBe(42)
    expect(lines.map(line => line.replace(/\d+\.\d ms/, 'n ms'))).toEqual([
      '[trace] backoffice workspace.get n ms',
      '[trace]   backoffice staff.enter n ms (conflict.retry {"attempt":1})',
      '[trace]   broken n ms (error: disk full)',
    ])
  })
})
```

## Un tracer para todo el proceso

La `Base` de un contexto acepta un `tracer` en sus opciones, solo para ese contexto. No
es lo que cooper quiere: una petición al backoffice que llama a casos de uso de auth
serían entonces dos trazas, una por contexto, y nada diría que son una sola.

**`setTracer(tracer)`**, de `newt/core`, fija el tracer de la aplicación: el que usan
los casos de uso de todos los contextos y las peticiones de todos los routers, salvo
que un contexto tenga el suyo. Fijado una vez, al arrancar la aplicación, una petición
que cruza contextos es una sola traza, porque todos sus spans van al mismo tracer, que
ve cuál está activo.

Rara vez la llamas tú. `runContexts` recibe el tracer como opción, lo fija antes de
servir nada, y llama a su `flush` cuando la aplicación se detiene, después de los
contextos (así se envían los últimos spans, para un tracer que envía por lotes).

### Qué tracer: la configuración

cooper elige el tracer con dos ajustes. Añádelos a `config.ts`, al final de `config`,
después de `backoffice`:

```ts
// cooper/backend/config.ts
// …
  /**
   * `COOPER_TRACE=1`: each use case any context runs written to the console, with
   * those it calls, in its context or another, and how long each took.
   */
  trace: env.COOPER_TRACE === '1',
  /**
   * `COOPER_OTLP_URL`: an OpenTelemetry collector (OTLP over HTTP,
   * `http://localhost:4318`) the traces go to instead, as service `cooper`.
   */
  otlpUrl: env.COOPER_OTLP_URL,
}
```

### OpenTelemetry sin su SDK: `newt/otel`

En producción, las trazas van a un colector: Jaeger, Grafana Tempo, Honeycomb, Datadog,
cualquiera que hable OTLP. **`OtlpTracer`**, de `newt/otel`, es el `Tracer` de newt que
envía los spans por OTLP/HTTP en JSON, al `/v1/traces` del colector. No necesita ningún
paquete de OpenTelemetry:

```ts
new OtlpTracer({ endpoint: 'http://localhost:4318', service: 'cooper' })
```

- **`endpoint`** es donde escucha el colector; **`service`** es el nombre de la
  aplicación en sus trazas (`service.name`). `headers` (una clave de API) e
  `intervalMs` son opcionales.
- Envía los spans que han terminado **cada 5 segundos**, y el resto en `flush`. Su
  temporizador nunca mantiene vivo el proceso por sí solo.
- Una exportación que falla se pierde, y se avisa en la consola. La aplicación sigue:
  un colector caído nunca se lleva a cooper por delante.

### `cooperTracer`

La elección va en `open-contexts.ts`, junto a la función que abre los contextos.
Importa lo que necesita:

```ts
// cooper/backend/open-contexts.ts
import { filterSpans, type Clock, type Tracer } from 'newt/core'
import { OtlpTracer } from 'newt/otel'
// …
import { ConsoleTracer } from './shared/observability/console-tracer'
```

y añádela después de `OpenContextsOptions`:

```ts
// cooper/backend/open-contexts.ts
/**
 * The application's tracer, for every context: OpenTelemetry's collector if
 * `COOPER_OTLP_URL` says where it is, else the console if `COOPER_TRACE` asks for it,
 * else none. The worker's own spans (`job.claim` every few seconds, `job.close`…) are
 * left out: what a job does is a use case, and that one is traced.
 */
export function cooperTracer(config: Config): Tracer | undefined {
  const tracer = config.otlpUrl ? new OtlpTracer({ endpoint: config.otlpUrl, service: 'cooper' })
    : config.trace ? new ConsoleTracer() : undefined
  return tracer && filterSpans(tracer, name => !name.startsWith('job.'))
}
```

**`filterSpans(tracer, keep)`** es un tracer que entrega a `tracer` solo los spans cuyo
nombre acepta `keep`. Los demás se ejecutan igual, sin span, y lo que arrancan es hijo
del span que los rodea. Sin él, el worker de cada contexto enviaría un span `job.claim`
cada pocos segundos, esté ocioso o no, y enterraría las trazas que quieres.

### La línea de los movimientos de tarjeta

Desde el capítulo [10](./10-events), boards escribe una línea en la consola cada vez que
se mueve una tarjeta, a través de su dependencia `log`, siempre. Es una traza a su
manera, así que ahora sigue el mismo ajuste. En `openContexts`, sustituye el comentario
y la línea que abre boards:

```ts
// cooper/backend/open-contexts.ts
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, search: new MemoryCardSearch(), log: config.trace ? line => console.log(line) : undefined }, clock)
```

### `index.ts` se lo pasa a `runContexts`

Importa `cooperTracer` y pásalo:

```ts
// cooper/backend/index.ts
import { cooperTracer, openContexts } from './open-contexts'
// …
// One tracer for every context: a request, and the use cases it calls in any context, is one trace.
const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })), { tracer: cooperTracer(config) })
```

Sin ninguno de los dos ajustes, `cooperTracer` da `undefined`, `runContexts` no fija
nada, y los spans van al `NoopTracer`, a un coste casi nulo.

## Los tests

`Config` tiene dos campos más, y las configuraciones de test que listan cada campo
dicen que el tracing está apagado, para que un `COOPER_TRACE=1` en tu shell no inunde
la salida de los tests. `postgres.test.ts`, del capítulo anterior:

```ts
// cooper/backend/postgres.test.ts
    backoffice: { ...config.backoffice, database: await fresh('backoffice'), port: 0 },
    trace: false,
  }
```

El helper de test del backoffice:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
    backoffice: { ...config.backoffice, database: ':memory:', port: 0 },
    trace: false,
  }
```

Y el test de inicio de sesión del backoffice:

```ts
// cooper/backend/contexts/backoffice/backoffice-sign-in.test.ts
      backoffice: { ...config.backoffice, database: ':memory:', port: backofficePort, publicUrl: backofficeUrl, authPublicUrl: authUrl },
      trace: false,
    }
```

`open-contexts.test.ts` recibe dos tests. Primero sus imports:

```ts
// cooper/backend/open-contexts.test.ts
import { expect, test } from 'bun:test'
import { runContexts } from 'newt/application'
import { NoopTracer, runAsActor, setTracer } from 'newt/core'
import { config, type Config } from './config'
import { PRODUCTS } from './contexts/auth/modules/product/product.schema'
import { cooperTracer, openContexts, stopContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'
import { ConsoleTracer } from './shared/observability/console-tracer'
```

Luego, al final del fichero, una traza a través de contextos. El `staff.me` del
backoffice entra como personal (`staff.enter`, que pregunta a `staff.isStaff`, que llama
al `access.check` de auth), y después lee a la persona de auth (`user.get`). Una sola
traza, con los spans de auth dentro de los del backoffice:

```ts
// cooper/backend/open-contexts.test.ts
test('traces a use case across contexts: auth\'s calls inside the backoffice\'s that made them', async () => {
  const lines: string[] = []
  const contexts = await openContexts(testConfig())
  setTracer(new ConsoleTracer(line => lines.push(line)))
  try {
    const { access, user } = contexts.auth.modules
    const sam = await user.signUp({ email: 'sam@cooper.test', name: 'Sam', password: 'a long password' })
    await access.admit({ userId: sam.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
    lines.length = 0

    await runAsActor({ userId: sam.id, via: 'web' }, () => contexts.backoffice.modules.staff.me())
    expect(lines.map(line => line.replace(/ \d+\.\d ms$/, ''))).toEqual([
      '[trace] backoffice staff.me',
      '[trace]   backoffice staff.enter',
      '[trace]     backoffice staff.isStaff',
      '[trace]       auth access.check',
      '[trace]   auth user.get',
    ])
  } finally {
    setTracer(new NoopTracer())
    await stopContexts(contexts)
  }
})
```

El tracer de la aplicación es del proceso, así que el test vuelve a poner el
`NoopTracer` en el `finally`: el siguiente test del mismo proceso no debe escribir en
las líneas de este.

Y qué tracer da cada ajuste. Un `Bun.serve` en un puerto libre hace de colector y
guarda lo que recibe:

```ts
// cooper/backend/open-contexts.test.ts
test('traces to OpenTelemetry\'s collector when COOPER_OTLP_URL says where, to the console under COOPER_TRACE, or nowhere', async () => {
  const exported: string[] = []
  const collector = Bun.serve({ port: 0, fetch: async request => { exported.push(`${new URL(request.url).pathname} ${await request.text()}`); return new Response('{}') } })
  try {
    const tracer = cooperTracer({ ...testConfig(), otlpUrl: collector.url.origin, trace: true })!
    await tracer.startActiveSpan('user.get', {}, async span => span.end())
    await tracer.startActiveSpan('job.claim', {}, async span => span.end())
    await tracer.flush!()

    expect(exported).toHaveLength(1)
    expect(exported[0]).toStartWith('/v1/traces ')
    expect(exported[0]).toContain('"user.get"')
    expect(exported[0]).toContain('"cooper"')
    expect(exported[0]).not.toContain('job.claim')
  } finally {
    await collector.stop()
  }

  expect(cooperTracer({ ...testConfig(), otlpUrl: undefined, trace: true })).toBeDefined()
  expect(cooperTracer({ ...testConfig(), otlpUrl: undefined, trace: false })).toBeUndefined()
})
```

El colector gana a la consola cuando están los dos; `job.claim` nunca sale; y `flush`
envía al instante lo que el temporizador habría enviado más tarde.

## Compruébalo

La puerta de control:

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint && bun run cooper:build
```

Solo los tests del tracing:

```sh
bun test cooper/backend/open-contexts.test.ts cooper/backend/shared/observability
```

```text
 5 pass
 0 fail
 25 expect() calls
Ran 5 tests across 2 files.
```

Ahora a mano. Arranca cooper con el tracer de consola:

```sh
COOPER_TRACE=1 bun cooper/backend/index.ts
```

y registra a alguien, desde otra terminal:

```sh
curl -s -X POST localhost:3001/api/session/sign-up -H 'content-type: application/json' \
  -d '{"email":"sam@cooper.test","name":"Sam","password":"a long password"}'
```

La consola del servidor muestra la traza de la petición, y un momento después el worker
del backoffice registrando el alta, una traza aparte (tus tiempos serán distintos; los
ticks del schedule de auth también aparecen de vez en cuando):

```text
[trace] POST /api/session/sign-up 94.2 ms
[trace]   auth session.signUp 93.5 ms
[trace]     auth user.signUp 90.3 ms
[trace] backoffice metric.recordSignUp 1.9 ms
```

Casi todo el tiempo de `user.signUp` es `Bun.password` calculando el hash de la
contraseña (capítulo [17](./17-auth)), que es lento a propósito.

Para ver las trazas en una herramienta de verdad, ejecuta Jaeger, que recibe OTLP sobre
HTTP en el 4318 y muestra las trazas en el 16686, y apunta cooper hacia él:

```sh
docker run -d --rm --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
COOPER_OTLP_URL=http://localhost:4318 bun cooper/backend/index.ts
```

Regístrate otra vez, abre `http://localhost:16686` y elige el servicio `cooper`: el
alta es una traza de tres spans, y `metric.recordSignUp` es otra. Para primero el
servidor y después el contenedor (`docker rm -f jaeger`): los últimos spans se envían
cuando el servidor se detiene.

## Qué recordar

- newt hace los spans: cada petición, cada caso de uso (en cualquier contexto), el caso
  de uso de cada job. Un `Tracer` decide adónde van; tú nunca arrancas uno en un módulo.
- Un tracer para todo el proceso: `runContexts(…, { tracer })` lo fija (`setTracer`) y
  lo vacía (`flush`) cuando la aplicación se detiene. Una petición que cruza contextos
  es entonces una sola traza.
- Un `Tracer` es un método. El `ConsoleTracer` de cooper son unas pocas líneas;
  `OtlpTracer` (`newt/otel`) envía a cualquier colector de OpenTelemetry, sin el SDK.
- `filterSpans` deja fuera lo que es ruido (los `job.*` del worker); lo que hace un job
  sigue trazado, como su caso de uso.
- Los errores de dominio son respuestas, no fallos: solo los demás errores marcan un
  span.

Siguiente: [Ponerlo en producción](./29-shipping).
