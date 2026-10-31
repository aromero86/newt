import type { Server } from 'bun'
import { hostname } from 'node:os'
import { systemClock } from '../core'
import { applicationTraces } from '../core/internal'
import { applicationMetrics, applicationSampler, InstanceSampler } from '../runtime/internal'
import { describeApplication, enableTraces, MemoryMetrics, type Base, type BoundedContext, type EventCounts, type Metrics, type OutboxState, type QueueFlows, type UseCaseTimings } from '../runtime'
import manifest from '../package.json'
import { MIN_KEY_LENGTH } from './monitor-signature'
import type { MonitorIdentity } from './monitor-identity'
import type { MonitorOptions } from './monitor-options'
import { MonitorVerifier } from './monitor-verifier'
import { MemoryNonces } from './nonce-store'
import { verifyTraceHeader } from './trace-header'

const json = (body: unknown) => Response.json(body, { headers: { 'cache-control': 'no-store' } })

/**
 * What an application tells whoever monitors it, on a port of its own: which it is
 * (`GET /v1/identity`), what it is made of (`GET /v1/structure`, as
 * `describeApplication` says it while it runs), how many times each event was told
 * minute by minute (`GET /v1/metrics/events?since=<minute>`, the minutes closed since),
 * how long each use case's calls took, minute by minute (`GET /v1/metrics/use-cases?since=`),
 * the events live (`GET /v1/metrics/live`, server-sent events), how full its queues are
 * now (`GET /v1/outbox`) and its dead jobs without their payloads
 * (`GET /v1/outbox/dead?context=&after=&limit=`), and the traces it kept, by the minute
 * they ended (`GET /v1/traces?since=<minute>`, whole minutes, about 2,000 traces a page),
 * and every instance with its server, as it is now and minute by minute
 * (`GET /v1/instances?since=<minute>`: with `RedisMetrics`, every instance's, whichever answers).
 * Read only, and never its data: serving it starts every context's counting
 * (`Base.metrics`), the instance's reading of itself and its server every 10 seconds
 * (its memory, processor time and event loop; the server's disks, memory and
 * processors) and the application's traces (`setTraces`; in its memory unless set),
 * and keeps whole the trace of every request with an `x-newt-trace` header signed with
 * its key (`signTraceHeader`).
 *
 * Only to a request signed with the key it shares with the monitor
 * (`signMonitorRequest`): any other gets a 401, the same whatever was wrong, and
 * learns nothing, not even which paths there are. It does not start without a key.
 *
 * ```ts
 * serveMonitor(contexts.all, { name: 'cooper', port: 3010, hostname: '0.0.0.0', key: env.COOPER_MONITOR_KEY })
 * ```
 */
export function serveMonitor(contexts: readonly (Base | BoundedContext)[], options: MonitorOptions): Server<undefined> {
  if (typeof options.key !== 'string' || options.key.length < MIN_KEY_LENGTH) {
    throw new Error(`The monitor's key has at least ${MIN_KEY_LENGTH} characters: it does not start without one`)
  }
  const clock = options.clock ?? systemClock
  const verifier = new MonitorVerifier(options.key, clock, options.nonces ?? new MemoryNonces())
  // Contexts may share one: each is asked once. Read at each request, as `describeApplication` reads them.
  const metricsOf = () => {
    const metrics = [...new Set(contexts.map(context => (('base' in context ? context.base : context) as Base).metrics))]
    for (const each of metrics) each.enable()
    return metrics
  }
  metricsOf()
  const traces = options.traces ?? enableTraces()
  // A request that carries a header signed with its key has its trace kept: `signTraceHeader`.
  applicationTraces.forcing = header => verifyTraceHeader(options.key, header, clock.now())
  const server = options.server ?? process.env.NEWT_SERVER ?? hostname()
  const identity: MonitorIdentity = {
    name: options.name,
    newt: manifest.version,
    instance: { id: crypto.randomUUID(), host: hostname(), server, pid: process.pid },
    startedAt: clock.now().toISOString(),
  }
  // The instance reads itself and its server into the application's metrics (`setMetrics`): else the first
  // context's, or its own memory with none. A test's own are served as they are.
  const instanceMetrics = options.instances ?? applicationMetrics.value ?? metricsOf()[0] ?? new MemoryMetrics()
  instanceMetrics.enable()
  if (!options.instances) {
    void applicationSampler.value?.stop()
    applicationSampler.value = new InstanceSampler(instanceMetrics, { instance: identity.instance.id, startedAt: identity.startedAt, server, disks: options.disks, clock })
    applicationSampler.value.start()
  }

  return Bun.serve({
    port: options.port,
    hostname: options.hostname ?? '127.0.0.1',
    // A live stream stays open: its heartbeat keeps it within this.
    idleTimeout: 60,
    async fetch(request) {
      if (!await verifier.verify(request)) return new Response(null, { status: 401 })
      const url = new URL(request.url)
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
      if (url.pathname === '/v1/identity') return json(identity)
      if (url.pathname === '/v1/structure') return json(describeApplication(contexts))
      if (url.pathname === '/v1/metrics/events') return json(await closedCounts(metricsOf(), url.searchParams.get('since'), clock.now()))
      if (url.pathname === '/v1/outbox') return json(await outboxState(contexts, clock.now()))
      if (url.pathname === '/v1/outbox/dead') {
        const base = baseOf(contexts, url.searchParams.get('context'))
        if (!base) return new Response(null, { status: 404 })
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50))
        return json(await base.jobs.dead(url.searchParams.get('after') ?? undefined, limit))
      }
      if (url.pathname === '/v1/metrics/queues') return json(await closedFlows(metricsOf(), url.searchParams.get('since'), clock.now()))
      if (url.pathname === '/v1/metrics/use-cases') return json(await closedTimings(metricsOf(), url.searchParams.get('since'), clock.now()))
      if (url.pathname === '/v1/traces') return json(await traces.closed(url.searchParams.get('since'), clock.now()))
      if (url.pathname === '/v1/instances') return json(await instanceMetrics.instances(validSince(url.searchParams.get('since')), clock.now()))
      if (url.pathname === '/v1/metrics/live') return liveCounts(metricsOf(), request.signal)
      return new Response(null, { status: 404 })
    },
  })
}

/** A cursor, if it is a time: else from the start. */
function validSince(since: string | null): string | null {
  return since !== null && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null
}

/** Every context's counts of the minutes closed since a minute, and the last one closed. */
async function closedCounts(metrics: Metrics[], since: string | null, now: Date): Promise<EventCounts> {
  const each = await Promise.all(metrics.map(one => one.closed(validSince(since), now)))
  // The earliest of their cursors: none of them has anything closed after it that is not in.
  const until = each.map(one => one.until).sort()[0] ?? new Date(now.getTime() - (now.getTime() % 60_000) - 60_000).toISOString()
  return { counts: each.flatMap(one => one.counts).filter(count => count.minute <= until), until }
}

/** Every context's use case timings of the minutes closed since a minute, and the last one closed. */
async function closedTimings(metrics: Metrics[], since: string | null, now: Date): Promise<UseCaseTimings> {
  const each = await Promise.all(metrics.map(one => one.closedTimings(validSince(since), now)))
  const until = each.map(one => one.until).sort()[0] ?? new Date(now.getTime() - (now.getTime() % 60_000) - 60_000).toISOString()
  return { timings: each.flatMap(one => one.timings).filter(timing => timing.minute <= until), until }
}

const basesOf = (contexts: readonly (Base | BoundedContext)[]) => contexts.map(context => ('base' in context ? context.base : context) as Base)

/** The base of the context of that name, if there is one. */
function baseOf(contexts: readonly (Base | BoundedContext)[], name: string | null): Base | undefined {
  return basesOf(contexts).find(base => base.name === name)
}

/** Every context's queues as they are now: read from its own outbox, by itself. */
async function outboxState(contexts: readonly (Base | BoundedContext)[], now: Date): Promise<OutboxState> {
  return { at: now.toISOString(), contexts: await Promise.all(basesOf(contexts).map(async base => ({ context: base.name, queues: await base.jobs.state() }))) }
}

/** Every context's queue flows of the minutes closed since a minute, and the last one closed. */
async function closedFlows(metrics: Metrics[], since: string | null, now: Date): Promise<QueueFlows> {
  const each = await Promise.all(metrics.map(one => one.closedFlows(validSince(since), now)))
  const until = each.map(one => one.until).sort()[0] ?? new Date(now.getTime() - (now.getTime() % 60_000) - 60_000).toISOString()
  return { flows: each.flatMap(one => one.flows).filter(flow => flow.minute <= until), until }
}

/** Counts as they come, as server-sent events, with a heartbeat every 8 seconds: whatever relays it, with an idle timeout of 10 (Bun's), keeps it open. */
function liveCounts(metrics: Metrics[], signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          // Closed meanwhile: nothing to send to.
        }
      }
      const stops = await Promise.all(metrics.map(one => one.live(counts => send(`data: ${JSON.stringify(counts)}\n\n`))))
      const heartbeat = setInterval(() => send(': heartbeat\n\n'), 8_000)
      send(': live\n\n')
      signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        for (const stop of stops) stop()
        try {
          controller.close()
        } catch {
          // Closed already.
        }
      })
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
}
