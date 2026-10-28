import { signMonitorRequest, type MonitorIdentity } from 'newt/monitor'
import type { ApplicationDescription, ClosedTraces, DeadJobs, EventCounts, OutboxState, QueueFlows, UseCaseTimings } from 'newt/runtime'
import { z } from 'zod'
import { AppCallFailed } from './app-call-failed'
import type { AppClient, Endpoint } from './app-client'

/** How long it waits for an answer. */
const TIMEOUT_MS = 5_000

/** Enough of an identity to know it is one. */
const IdentitySchema = z.object({
  name: z.string(),
  newt: z.string(),
  instance: z.object({ id: z.string(), host: z.string(), pid: z.number() }),
  startedAt: z.string(),
})

/** Enough of a description to know it is one, and of the version the monitor reads. */
const StructureSchema = z.looseObject({ version: z.literal(1), contexts: z.array(z.looseObject({ name: z.string() })) })

/** Enough of a page of counts to know it is one. */
const CountsSchema = z.object({
  counts: z.array(z.object({
    minute: z.iso.datetime(),
    context: z.string(),
    event: z.string(),
    scopes: z.record(z.string(), z.string()),
    actor: z.string().nullable(),
    count: z.number().int().positive(),
  })),
  until: z.iso.datetime(),
})

/** Enough of a page of timings to know it is one. */
const TimingsSchema = z.object({
  timings: z.array(z.object({
    minute: z.iso.datetime(),
    context: z.string(),
    useCase: z.string(),
    scopes: z.record(z.string(), z.string()),
    actor: z.string().nullable(),
    calls: z.number().int().positive(),
    retries: z.number().int().min(0),
    totalMs: z.number().min(0),
    histogram: z.record(z.string().regex(/^\d+$/), z.number().int().positive()),
    // An application on a newt before errors were counted sends none.
    errors: z.record(z.string(), z.number().int().positive()).default({}),
    failures: z.record(z.string(), z.number().int().positive()).default({}),
  })),
  until: z.iso.datetime(),
})

/** Enough of a page of queue flows to know it is one. */
const FlowsSchema = z.object({
  flows: z.array(z.object({
    minute: z.iso.datetime(),
    context: z.string(),
    queue: z.string(),
    published: z.number().int().min(0),
    delivered: z.number().int().min(0),
    redelivered: z.number().int().min(0),
    dead: z.number().int().min(0),
    wait: z.record(z.string().regex(/^\d+$/), z.number().int().positive()),
  })),
  until: z.iso.datetime(),
})

const OutcomeSchema = z.object({ kind: z.enum(['error', 'failure']), code: z.string() }).nullable()

/** Enough of a page of traces to know it is one: each a tree of spans. */
const TracesSchema = z.object({
  traces: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['http', 'job']),
    name: z.string(),
    startedAt: z.iso.datetime(),
    ms: z.number().min(0),
    outcome: OutcomeSchema,
    retried: z.boolean(),
    actor: z.string().nullable(),
    scopes: z.record(z.string(), z.string()),
    useCases: z.array(z.string()),
    told: z.array(z.object({ id: z.string(), name: z.string(), context: z.string() })),
    job: z.object({ id: z.string(), queue: z.string(), run: z.number().int().min(1), event: z.string(), eventId: z.string() }).nullable(),
    spans: z.array(z.object({
      id: z.string(),
      parentId: z.string().nullable(),
      kind: z.enum(['http', 'job', 'use-case', 'attempt', 'query', 'transaction', 'event']),
      name: z.string(),
      context: z.string().nullable(),
      startMs: z.number(),
      ms: z.number().min(0),
      outcome: OutcomeSchema,
      attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      failure: z.object({ message: z.string(), stack: z.string().nullable() }).nullable(),
    })).min(1),
    dropped: z.number().int().min(0),
    // An application on a newt before it kept why, or its log lines: none.
    forced: z.string().nullable().default(null),
    logs: z.array(z.object({
      spanId: z.string(),
      atMs: z.number(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      message: z.string(),
      fields: z.record(z.string(), z.unknown()),
    })).default([]),
    droppedLogs: z.number().int().min(0).default(0),
  })),
  until: z.iso.datetime(),
})

/** Enough of an outbox's state to know it is one. */
const OutboxSchema = z.object({
  at: z.iso.datetime(),
  contexts: z.array(z.object({
    context: z.string(),
    queues: z.array(z.object({
      queue: z.string(),
      ready: z.number().int().min(0),
      retrying: z.number().int().min(0),
      running: z.number().int().min(0),
      dead: z.number().int().min(0),
      oldestDueAt: z.string().nullable(),
      lastSeenAt: z.string().nullable(),
      orphan: z.boolean(),
    })),
  })),
})

/** Enough of a page of dead jobs to know it is one: never a payload. */
const DeadJobsSchema = z.object({
  jobs: z.array(z.object({
    id: z.string(),
    queue: z.string(),
    event: z.string(),
    attempts: z.number().int().min(0),
    lastError: z.string().nullable(),
    createdAt: z.string(),
    diedAt: z.string(),
  })),
  hasMore: z.boolean(),
})

/** `AppClient` over HTTP: each request signed with the endpoint's key, which never travels. */
export class HttpAppClient implements AppClient {

  async identity(endpoint: Endpoint): Promise<MonitorIdentity> {
    return this.read(endpoint, '/v1/identity', IdentitySchema)
  }

  async structure(endpoint: Endpoint): Promise<ApplicationDescription> {
    return this.read(endpoint, '/v1/structure', StructureSchema) as Promise<unknown> as Promise<ApplicationDescription>
  }

  async metrics(endpoint: Endpoint, since: string | null): Promise<EventCounts> {
    return this.read(endpoint, since === null ? '/v1/metrics/events' : `/v1/metrics/events?since=${encodeURIComponent(since)}`, CountsSchema)
  }

  async timings(endpoint: Endpoint, since: string | null): Promise<UseCaseTimings> {
    return this.read(endpoint, since === null ? '/v1/metrics/use-cases' : `/v1/metrics/use-cases?since=${encodeURIComponent(since)}`, TimingsSchema)
  }

  async flows(endpoint: Endpoint, since: string | null): Promise<QueueFlows> {
    return this.read(endpoint, since === null ? '/v1/metrics/queues' : `/v1/metrics/queues?since=${encodeURIComponent(since)}`, FlowsSchema)
  }

  async traces(endpoint: Endpoint, since: string | null): Promise<ClosedTraces> {
    return this.read(endpoint, since === null ? '/v1/traces' : `/v1/traces?since=${encodeURIComponent(since)}`, TracesSchema)
  }

  async outbox(endpoint: Endpoint): Promise<OutboxState> {
    return this.read(endpoint, '/v1/outbox', OutboxSchema)
  }

  async deadJobs(endpoint: Endpoint, context: string, after: string | null, limit: number): Promise<DeadJobs> {
    const query = new URLSearchParams({ context, limit: String(limit), ...(after ? { after } : {}) })
    return this.read(endpoint, `/v1/outbox/dead?${query}`, DeadJobsSchema)
  }

  async live(endpoint: Endpoint, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const url = `${endpoint.url}/v1/metrics/live`
    let response: Response
    try {
      response = await fetch(url, { headers: signMonitorRequest(endpoint.key, { url }), signal })
    } catch (error) {
      throw new AppCallFailed('unreachable', `Nobody answered at ${endpoint.url}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.status === 401) throw new AppCallFailed('key_rejected', `${endpoint.url} refused the signature: the key is not the application's`)
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
      throw new AppCallFailed('bad_answer', `${endpoint.url} has no live metrics: is its newt recent enough?`)
    }
    return response.body
  }

  /** What `path` answers, if it is what `schema` says: anything else is no monitor endpoint's. */
  private async read<T>(endpoint: Endpoint, path: string, schema: z.ZodType<T>): Promise<T> {
    const parsed = schema.safeParse(await this.get(endpoint, path))
    if (!parsed.success) throw new AppCallFailed('bad_answer', `${endpoint.url}${path} answered something that is not a monitor endpoint's`)
    return parsed.data
  }

  private async get(endpoint: Endpoint, path: string): Promise<unknown> {
    const url = `${endpoint.url}${path}`
    let response: Response
    try {
      response = await fetch(url, { headers: signMonitorRequest(endpoint.key, { url }), signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      throw new AppCallFailed('unreachable', `Nobody answered at ${endpoint.url}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.status === 401) throw new AppCallFailed('key_rejected', `${endpoint.url} refused the signature: the key is not the application's`)
    if (!response.ok) throw new AppCallFailed('bad_answer', `${endpoint.url} answered ${response.status}: is it a monitor endpoint?`)
    try {
      return await response.json()
    } catch {
      throw new AppCallFailed('bad_answer', `${endpoint.url} answered something that is not JSON: is it a monitor endpoint?`)
    }
  }
}
