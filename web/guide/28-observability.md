# Observability

A request to cooper rarely stays in one place. Signing up at auth runs
`session.signUp`, which runs `user.signUp`; a moment later the backoffice's worker
records the sign-up. Opening the backoffice runs `staff.me`, which asks auth whether
you are staff. When one of them is slow, or fails, you want to see the whole of it:
what called what, in which context, and how long each took.

That is a **trace**: a tree of **spans**, one for each thing that ran, each inside the
one that called it. newt starts the spans for you, around every request and every use
case. What it leaves to you is where they go. In this chapter cooper sends them to the
console, or to an OpenTelemetry collector, and one request that crosses contexts is
one trace.

What you add:

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

## Tracer and Span

newt's tracing is two small interfaces in `newt/core`. A **`Tracer`** runs a function
inside a span:

```ts
// packages/newt/core/observability/tracer.ts
export interface Tracer {
  startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T>
  /** Sends the spans it still keeps, for one that sends them in batches: once the application stops. */
  flush?(): Promise<void>
}
```

The span is **active** while `fn` runs: a span started inside it, however deep in the
calls, is its child. Keeping track of which span is active is the tracer's job. A
**`Span`** is what `fn` gets to note what happened:

```ts
// packages/newt/core/observability/span.ts
export interface Span {
  setError(error: unknown): void
  /** Something worth noting that happened during the span, with what describes it. */
  addEvent(name: string, attributes: SpanAttributes): void
  end(): void
}
```

`SpanAttributes` are what describe a span: `Record<string, string | number | boolean>`.

These are the same shapes as OpenTelemetry's, on purpose: any APM can sit behind
them. You do not call them in a module. newt does:

- **Every use case** is a span, named as the use case (`user.signUp`), with
  `{ context, module, useCase }` as attributes. One called from inside another, in
  the same context or in another, is its child. An error that is not a domain error
  (a `DomainError` is an answer, not a failure) marks the span with `setError`. A
  conflict that runs the use case again is an event on its span, `conflict.retry`,
  with the attempt.
- **Every request** a router answers is a span, `POST /api/session/sign-up`, with
  `http.method` and `http.route`. It is the root of the request's trace: the use cases
  its route calls are inside it. A 5xx answer marks it as an error.
- **Jobs**: what a job does is a use case (a handler calls one, chapter
  [11](./11-reacting)), so it is a span of its own, the root of its trace, since the
  worker runs it apart from the request that wrote the job. A schedule's tick is
  `schedule.tick`. The worker's own housekeeping is spans too: `job.claim` every few
  seconds, `job.renew`, `job.close`, `job.seen`, `job.purge`.

Until someone gives newt a tracer, every span goes to a `NoopTracer`, which runs the
function and notes nothing.

## A tracer of cooper's own: the console

To read traces while you develop, cooper writes each one to the console once it ends,
indented by depth, with its time. That is a `Tracer` of a few lines, in a new folder,
`shared/observability`:

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

- **`AsyncLocalStorage`** keeps the active span. `active.run(traced, …)` makes it the
  active one for everything `fn` awaits, so a span started anywhere inside finds its
  parent with `getStore()`.
- **A trace is written whole, once its root ends.** Spans of different requests run at
  the same time; printing each as it ends would interleave them. The root keeps its
  children, and `print` walks the tree.
- **The writer is a function**, `console.log` by default, so its test reads the lines.

Its test:

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

## One tracer for the whole process

A context's `Base` takes a `tracer` in its options, for that context alone. That is
not what cooper wants: a request to the backoffice that calls auth's use cases would
then be two traces, one per context, and nothing would say they are one.

**`setTracer(tracer)`**, from `newt/core`, sets the application's tracer: the one
every context's use cases and every router's requests use, unless a context has its
own. Set once, as the application starts, a request that crosses contexts is one
trace, because every span of it goes to the same tracer, which sees which one is
active.

You rarely call it yourself. `runContexts` takes the tracer as an option, sets it
before it serves anything, and calls its `flush` as the application stops, after the
contexts (so the last spans are sent, for a tracer that sends in batches).

### Which tracer: the settings

cooper picks the tracer from two settings. Add them to `config.ts`, at the end of
`config`, after `backoffice`:

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

### OpenTelemetry without its SDK: `newt/otel`

In production, traces go to a collector: Jaeger, Grafana Tempo, Honeycomb, Datadog,
any that speaks OTLP. **`OtlpTracer`**, from `newt/otel`, is newt's `Tracer` that sends
spans over OTLP/HTTP in JSON, to the collector's `/v1/traces`. It needs no
OpenTelemetry package:

```ts
new OtlpTracer({ endpoint: 'http://localhost:4318', service: 'cooper' })
```

- **`endpoint`** is where the collector listens; **`service`** is the application's
  name in its traces (`service.name`). `headers` (an API key) and `intervalMs` are
  optional.
- It sends the spans that ended **every 5 seconds**, and the rest on `flush`. Its timer
  never keeps the process alive on its own.
- An export that fails is lost, and said on the console. The application goes on: a
  collector that is down never takes cooper down with it.

### `cooperTracer`

The choice goes in `open-contexts.ts`, beside the function that opens the contexts.
Import what it needs:

```ts
// cooper/backend/open-contexts.ts
import { filterSpans, type Clock, type Tracer } from 'newt/core'
import { OtlpTracer } from 'newt/otel'
// …
import { ConsoleTracer } from './shared/observability/console-tracer'
```

and add it after `OpenContextsOptions`:

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

**`filterSpans(tracer, keep)`** is a tracer that hands `tracer` only the spans whose
name `keep` accepts. The others still run, without a span, and what they start is a
child of the span around them. Without it, each context's worker would send a
`job.claim` span every few seconds, idle or not, and bury the traces you want.

### The card moves' line

Since chapter [10](./10-events), boards writes a line to the console as each card
moves, through its `log` dependency, always. It is a trace of sorts, so it now follows
the same setting. In `openContexts`, replace the comment and the line that opens
boards:

```ts
// cooper/backend/open-contexts.ts
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, search: new MemoryCardSearch(), log: config.trace ? line => console.log(line) : undefined }, clock)
```

### `index.ts` hands it to `runContexts`

Import `cooperTracer` and pass it:

```ts
// cooper/backend/index.ts
import { cooperTracer, openContexts } from './open-contexts'
// …
// One tracer for every context: a request, and the use cases it calls in any context, is one trace.
const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })), { tracer: cooperTracer(config) })
```

With neither setting, `cooperTracer` gives `undefined`, `runContexts` sets nothing,
and the spans go to the `NoopTracer`, at almost no cost.

## The tests

`Config` has two fields more, and the test configurations that list every field say
the tracing is off, so a `COOPER_TRACE=1` in your shell does not flood the tests'
output. `postgres.test.ts`, from the last chapter:

```ts
// cooper/backend/postgres.test.ts
    backoffice: { ...config.backoffice, database: await fresh('backoffice'), port: 0 },
    trace: false,
  }
```

The backoffice's test helper:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
    backoffice: { ...config.backoffice, database: ':memory:', port: 0 },
    trace: false,
  }
```

And the backoffice's sign-in test:

```ts
// cooper/backend/contexts/backoffice/backoffice-sign-in.test.ts
      backoffice: { ...config.backoffice, database: ':memory:', port: backofficePort, publicUrl: backofficeUrl, authPublicUrl: authUrl },
      trace: false,
    }
```

`open-contexts.test.ts` gets two tests. First its imports:

```ts
// cooper/backend/open-contexts.test.ts
import { expect, test } from 'bun:test'
import { runContexts } from 'newt/application'
import { NoopTracer, runAsActor, setTracer } from 'newt/core'
import { config, type Config } from './config'
import { PRODUCTS } from './contexts/auth/modules/product/product.schema'
import { cooperTracer, openContexts, stopContexts } from './open-contexts'
import { RecordingMailer } from './shared/mail/recording-mailer'
import { ConsoleTracer } from './shared/observability/console-tracer'
```

Then, at the end of the file, a trace across contexts. The backoffice's `staff.me`
enters as staff (`staff.enter`, which asks `staff.isStaff`, which calls auth's
`access.check`), then reads the person from auth (`user.get`). One trace, auth's spans
inside the backoffice's:

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

The application's tracer is the process's, so the test puts the `NoopTracer` back in
`finally`: the next test in the same process must not write to this one's lines.

And which tracer each setting gives. A `Bun.serve` on a free port stands in for the
collector and keeps what it receives:

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

The collector wins over the console when both are set; `job.claim` never leaves; and
`flush` sends at once what the timer would have sent later.

## Check it

The gate:

```sh
bun install && bun check && bun test cooper && bun run lint && bun run cooper:build
```

The tracing tests alone:

```sh
bun test cooper/backend/open-contexts.test.ts cooper/backend/shared/observability
```

```text
 5 pass
 0 fail
 25 expect() calls
Ran 5 tests across 2 files.
```

Now by hand. Start cooper with the console tracer:

```sh
COOPER_TRACE=1 bun cooper/backend/index.ts
```

and sign someone up, from another terminal:

```sh
curl -s -X POST localhost:3001/api/session/sign-up -H 'content-type: application/json' \
  -d '{"email":"sam@cooper.test","name":"Sam","password":"a long password"}'
```

The server's console shows the request's trace, and a moment later the backoffice's
worker recording the sign-up, a trace of its own (your times will differ; auth's
schedule ticks show up now and then too):

```text
[trace] POST /api/session/sign-up 94.2 ms
[trace]   auth session.signUp 93.5 ms
[trace]     auth user.signUp 90.3 ms
[trace] backoffice metric.recordSignUp 1.9 ms
```

Most of `user.signUp`'s time is `Bun.password` hashing the password (chapter
[17](./17-auth)), which is slow on purpose.

To see the traces in a real tool, run Jaeger, which takes OTLP over HTTP on 4318 and
shows traces on 16686, and point cooper at it:

```sh
docker run -d --rm --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
COOPER_OTLP_URL=http://localhost:4318 bun cooper/backend/index.ts
```

Sign up again, open `http://localhost:16686`, and pick the service `cooper`: the
sign-up is one trace of three spans, and `metric.recordSignUp` another. Stop the
server first and then the container (`docker rm -f jaeger`): the last spans are sent
as the server stops.

## What to remember

- newt makes the spans: every request, every use case (in any context), every job's
  use case. A `Tracer` decides where they go; you never start one in a module.
- One tracer for the whole process: `runContexts(…, { tracer })` sets it
  (`setTracer`) and flushes it as the application stops. A request that crosses
  contexts is then one trace.
- A `Tracer` is one method. cooper's `ConsoleTracer` is a few lines; `OtlpTracer`
  (`newt/otel`) sends to any OpenTelemetry collector, without the SDK.
- `filterSpans` leaves out what is noise (the worker's `job.*`); what a job does is
  still traced, as its use case.
- Domain errors are answers, not failures: only other errors mark a span.

Next: [Shipping it](./29-shipping).
