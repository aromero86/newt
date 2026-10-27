import type { MonitorIdentity } from 'newt/monitor'
import type { ApplicationDescription, ClosedTraces, DeadJobs, EventCounts, OutboxState, QueueFlows, UseCaseTimings } from 'newt/runtime'

/** Where an application's monitor endpoint is, and the key to sign with. */
export type Endpoint = { url: string, key: string }

/**
 * What the monitor asks an application, through its monitor endpoint
 * (`serveMonitor`): a port, since an application is no module of the monitor's. Each
 * call either answers or throws `AppCallFailed`, which says why.
 */
export interface AppClient {
  /** Which application, and which process of it. */
  identity(endpoint: Endpoint): Promise<MonitorIdentity>
  /** What it is made of, as `describeApplication` says it. */
  structure(endpoint: Endpoint): Promise<ApplicationDescription>
  /** How many times each event was told, minute by minute, in the minutes closed after `since`. */
  metrics(endpoint: Endpoint, since: string | null): Promise<EventCounts>
  /** How long each use case's calls took, minute by minute, in the minutes closed after `since`. */
  timings(endpoint: Endpoint, since: string | null): Promise<UseCaseTimings>
  /** How its queues' jobs went, minute by minute, in the minutes closed after `since`. */
  flows(endpoint: Endpoint, since: string | null): Promise<QueueFlows>
  /** The traces it kept, in the minutes closed after `since`: whole minutes, a page at a time. */
  traces(endpoint: Endpoint, since: string | null): Promise<ClosedTraces>
  /** How full its queues are now. */
  outbox(endpoint: Endpoint): Promise<OutboxState>
  /** A page of a context's dead jobs, without their payloads. */
  deadJobs(endpoint: Endpoint, context: string, after: string | null, limit: number): Promise<DeadJobs>
  /** Its counts as they come, as the server-sent events it sends, until `signal` aborts. */
  live(endpoint: Endpoint, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>
}
