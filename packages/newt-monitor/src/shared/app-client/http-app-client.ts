import { signMonitorRequest, type MonitorIdentity } from 'newt/monitor'
import type { ApplicationDescription, EventCounts, UseCaseTimings } from 'newt/runtime'
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
