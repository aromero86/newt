import type { Server } from 'bun'
import { hostname } from 'node:os'
import { systemClock } from '../core'
import { describeApplication, type Base, type BoundedContext, type EventCounts, type EventMetrics } from '../runtime'
import manifest from '../package.json'
import { MIN_KEY_LENGTH } from './monitor-signature'
import type { MonitorIdentity } from './monitor-identity'
import type { MonitorOptions } from './monitor-options'
import { MonitorVerifier } from './monitor-verifier'
import { MemoryNonces } from './nonce-store'

const json = (body: unknown) => Response.json(body, { headers: { 'cache-control': 'no-store' } })

/**
 * What an application tells whoever monitors it, on a port of its own: which it is
 * (`GET /v1/identity`), what it is made of (`GET /v1/structure`, as
 * `describeApplication` says it while it runs), how many times each event was told
 * minute by minute (`GET /v1/metrics?since=<minute>`, the minutes closed since), and
 * the same live (`GET /v1/metrics/live`, server-sent events). Read only, and never its
 * data: serving it starts every context's counting (`Base.metrics`).
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
  const identity: MonitorIdentity = {
    name: options.name,
    newt: manifest.version,
    instance: { id: crypto.randomUUID(), host: hostname(), pid: process.pid },
    startedAt: clock.now().toISOString(),
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
      if (url.pathname === '/v1/metrics') return json(await closedCounts(metricsOf(), url.searchParams.get('since'), clock.now()))
      if (url.pathname === '/v1/metrics/live') return liveCounts(metricsOf(), request.signal)
      return new Response(null, { status: 404 })
    },
  })
}

/** Every context's counts of the minutes closed since a minute, and the last one closed. */
async function closedCounts(metrics: EventMetrics[], since: string | null, now: Date): Promise<EventCounts> {
  const valid = since !== null && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null
  const each = await Promise.all(metrics.map(one => one.closed(valid, now)))
  // The earliest of their cursors: none of them has anything closed after it that is not in.
  const until = each.map(one => one.until).sort()[0] ?? new Date(now.getTime() - (now.getTime() % 60_000) - 60_000).toISOString()
  return { counts: each.flatMap(one => one.counts).filter(count => count.minute <= until), until }
}

/** Counts as they come, as server-sent events, with a heartbeat every 20 seconds. */
function liveCounts(metrics: EventMetrics[], signal: AbortSignal): Response {
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
      const heartbeat = setInterval(() => send(': heartbeat\n\n'), 20_000)
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
