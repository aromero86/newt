import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { Server } from 'bun'
import { OtlpTracer } from './otlp-tracer'

type Exported = {
  resourceSpans: {
    resource: { attributes: { key: string, value: Record<string, unknown> }[] }
    scopeSpans: { scope: { name: string }, spans: Record<string, unknown>[] }[]
  }[]
}

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
})

/** A collector that keeps what it is sent, and the headers it came with; or answers `status`. */
function collector(status = 200) {
  const received: { path: string, headers: Headers, body: Exported }[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async request => {
      received.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() as Exported })
      return new Response(null, { status })
    },
  })
  servers.push(server)
  return { url: server.url.toString(), received }
}

describe('OtlpTracer', () => {
  test('sends the spans to the collector as OTLP JSON: one trace, each span its caller\'s child', async () => {
    const { url, received } = collector()
    const tracer = new OtlpTracer({ endpoint: url, service: 'cooper', headers: { 'x-api-key': 'secret' }, intervalMs: 60_000 })

    const answer = await tracer.startActiveSpan('GET /api/boards/:id', { 'http.method': 'GET' }, async () => {
      await tracer.startActiveSpan('board.get', { context: 'boards', attempt: 2, ratio: 0.5, cached: false }, async span => {
        span.addEvent('conflict.retry', { attempt: 1 })
        span.end()
      })
      await tracer.startActiveSpan('access.check', { context: 'auth' }, async span => span.setError(new Error('disk full')))
      return 42
    })
    expect(answer).toBe(42)
    expect(received).toEqual([])
    await tracer.shutdown()

    expect(received).toHaveLength(1)
    const [{ path, headers, body }] = received as [typeof received[0]]
    expect(path).toBe('/v1/traces')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-api-key')).toBe('secret')
    const [resourceSpans] = body.resourceSpans
    expect(resourceSpans!.resource.attributes).toEqual([{ key: 'service.name', value: { stringValue: 'cooper' } }])
    const spans = resourceSpans!.scopeSpans[0]!.spans as {
      traceId: string, spanId: string, parentSpanId?: string, name: string, startTimeUnixNano: string, endTimeUnixNano: string,
      attributes: unknown[], events: { name: string }[], status: { code: number, message?: string }
    }[]
    const byName = Object.fromEntries(spans.map(span => [span.name, span]))
    const [root, get, check] = [byName['GET /api/boards/:id']!, byName['board.get']!, byName['access.check']!]

    expect(spans.map(span => span.name)).toEqual(['board.get', 'access.check', 'GET /api/boards/:id'])
    expect(root.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(root.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(root.parentSpanId).toBeUndefined()
    expect([get.traceId, check.traceId]).toEqual([root.traceId, root.traceId])
    expect([get.parentSpanId, check.parentSpanId]).toEqual([root.spanId, root.spanId])
    expect(BigInt(root.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(get.endTimeUnixNano))
    expect(BigInt(get.startTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(root.startTimeUnixNano))
    expect(get.attributes).toEqual([
      { key: 'context', value: { stringValue: 'boards' } },
      { key: 'attempt', value: { intValue: '2' } },
      { key: 'ratio', value: { doubleValue: 0.5 } },
      { key: 'cached', value: { boolValue: false } },
    ])
    expect(get.events.map(event => event.name)).toEqual(['conflict.retry'])
    expect(get.status).toEqual({ code: 0 })
    expect(check.status).toEqual({ code: 2, message: 'disk full' })
  })

  test('sends on its own every interval, and a new trace for each span begun outside another', async () => {
    const { url, received } = collector()
    const tracer = new OtlpTracer({ endpoint: url, service: 'cooper', intervalMs: 20 })
    await tracer.startActiveSpan('one', {}, async () => {})
    await tracer.startActiveSpan('two', {}, async () => {})
    await Bun.sleep(80)
    await tracer.shutdown()

    const spans = received.flatMap(each => each.body.resourceSpans[0]!.scopeSpans[0]!.spans) as { traceId: string }[]
    expect(spans).toHaveLength(2)
    expect(spans[0]!.traceId).not.toBe(spans[1]!.traceId)
  })

  test('a collector that fails loses those spans, and the application goes on', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { url } = collector(503)
      const tracer = new OtlpTracer({ endpoint: url, service: 'cooper', intervalMs: 60_000 })
      expect(await tracer.startActiveSpan('one', {}, async () => 'done')).toBe('done')
      await tracer.flush()
      const unreachable = new OtlpTracer({ endpoint: 'http://127.0.0.1:1', service: 'cooper', intervalMs: 60_000 })
      await unreachable.startActiveSpan('two', {}, async () => {})
      await unreachable.shutdown()
      await tracer.shutdown()
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })
})
