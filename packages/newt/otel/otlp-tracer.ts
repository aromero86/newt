import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span, SpanAttributes, Tracer } from '../core'
import type { OtlpTracerOptions } from './otlp-tracer-options'

/** A span as OTLP's JSON says it (`opentelemetry/proto/trace/v1`). */
type OtlpSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
  events: { timeUnixNano: string, name: string, attributes: OtlpAttribute[] }[]
  status: { code: number, message?: string }
}

type OtlpAttribute = { key: string, value: { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean } }

const INTERNAL = 1
const STATUS_OK = 0
const STATUS_ERROR = 2

/** Random bytes in hex: a trace id is 16, a span id 8. */
const hexId = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('hex')

/** Now, in nanoseconds since the epoch, as OTLP's JSON writes a 64-bit number. */
const now = () => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)).toString()

const attributesOf = (attributes: SpanAttributes): OtlpAttribute[] => Object.entries(attributes).map(([key, value]) => ({
  key,
  value: typeof value === 'string' ? { stringValue: value }
    : typeof value === 'boolean' ? { boolValue: value }
      : Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value },
}))

/**
 * newt's `Tracer` that sends each span to an OpenTelemetry collector, over OTLP/HTTP in
 * JSON, without OpenTelemetry's SDK: the spans that ended go every few seconds, and
 * the rest when the application stops (`flush`). A span started inside another is its
 * child, of the same trace. An export that fails is lost, and said on the console:
 * the application goes on.
 *
 * ```ts
 * runContexts(contexts, { tracer: new OtlpTracer({ endpoint: 'http://localhost:4318', service: 'cooper' }) })
 * ```
 */
export class OtlpTracer implements Tracer {

  /** The span running now, which a span started inside it is a child of. */
  private readonly active = new AsyncLocalStorage<{ traceId: string, spanId: string }>()
  private ended: OtlpSpan[] = []
  private readonly timer: ReturnType<typeof setInterval>

  constructor(private readonly options: OtlpTracerOptions) {
    this.timer = setInterval(() => void this.flush(), options.intervalMs ?? 5000)
    // It never keeps the process alive on its own.
    this.timer.unref()
  }

  async startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    const parent = this.active.getStore()
    const ids = { traceId: parent?.traceId ?? hexId(16), spanId: hexId(8) }
    const traced: OtlpSpan = {
      ...ids,
      ...(parent ? { parentSpanId: parent.spanId } : {}),
      name,
      kind: INTERNAL,
      startTimeUnixNano: now(),
      endTimeUnixNano: '',
      attributes: attributesOf(attributes),
      events: [],
      status: { code: STATUS_OK },
    }
    const span: Span = {
      setError: error => { traced.status = { code: STATUS_ERROR, message: error instanceof Error ? error.message : String(error) } },
      addEvent: (event, eventAttributes) => { traced.events.push({ timeUnixNano: now(), name: event, attributes: attributesOf(eventAttributes) }) },
      end: () => {
        if (traced.endTimeUnixNano) return
        traced.endTimeUnixNano = now()
        this.ended.push(traced)
      },
    }
    try {
      return await this.active.run(ids, () => fn(span))
    } finally {
      span.end()
    }
  }

  /** Sends the spans that ended and were not sent yet. */
  async flush(): Promise<void> {
    if (!this.ended.length) return
    const spans = this.ended
    this.ended = []
    const body = {
      resourceSpans: [{
        resource: { attributes: attributesOf({ 'service.name': this.options.service }) },
        scopeSpans: [{ scope: { name: 'newt' }, spans }],
      }],
    }
    try {
      const response = await fetch(`${this.options.endpoint.replace(/\/$/, '')}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.options.headers },
        body: JSON.stringify(body),
      })
      if (!response.ok) console.warn(`[otel] the collector answered ${response.status}: ${spans.length} spans lost`)
    } catch (error) {
      console.warn(`[otel] the collector cannot be reached: ${spans.length} spans lost`, error)
    }
  }

  /** Sends what is left, and stops sending every few seconds. */
  async shutdown(): Promise<void> {
    clearInterval(this.timer)
    await this.flush()
  }
}
