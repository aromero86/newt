import { eventsOf, Module, UseCase } from '@newt-kit/newt/core'
import type { ApplicationDescription, ClosedTraces, DeadJobs, EventCounts, Instances, OutboxState, QueueFlows, UseCaseTimings } from '@newt-kit/newt/runtime'
import type { MonitorBase } from '../../../../monitor-base'
import { AppCallFailed } from '../../../../shared/app-client/app-call-failed'
import type { Endpoint } from '../../../../shared/app-client/app-client'
import { SealedKeyUnreadable } from '../../../../shared/key-cipher'
import { Connection, type ConnectionStatusDTO, type FailureDTO, type Outcome } from './connection'
import type { Connection_Deps } from './connection.deps'
import { Connection_Repository } from './connection.repository'
import { registerConnectionRoutes } from './connection.routes'
import { registerConnectionWorkers } from './connection.workers'
import { Connection_Lost } from './events/connection-lost'
import { Connection_Restored } from './events/connection-restored'

/** What a call to an application answered, or why it did not. */
type Called<T> = { answered: true, value: T } | { answered: false, failure: FailureDTO }

/**
 * Talking to the applications: every request signed with the application's key, and
 * whether each one answers, recorded each time it is asked.
 */
export class Connection_Module extends Module {

  static initialize(base: MonitorBase, deps: Connection_Deps): Connection_Module {
    const module = new Connection_Module(base, new Connection_Repository(base), deps)
    registerConnectionRoutes(base, module)
    registerConnectionWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(base: MonitorBase, private readonly repo: Connection_Repository, private readonly deps: Connection_Deps) {
    super('connection', base.invocations, deps)
    this.events = eventsOf(base.bus, { lost: Connection_Lost, restored: Connection_Restored })
  }

  /** Asks an application which it is, and records whether it answered. */
  @UseCase()
  async check(appId: string): Promise<ConnectionStatusDTO> {
    const called = await this.call(appId, endpoint => this.deps.client.identity(endpoint))
    await this.record(appId, called.answered ? { answered: true, identity: called.value } : called)
    return this.status(appId)
  }

  /** What an application is made of, if it answers; recorded as any call to it is. */
  @UseCase()
  async fetchStructure(appId: string): Promise<Called<ApplicationDescription>> {
    const called = await this.call(appId, endpoint => this.deps.client.structure(endpoint))
    await this.record(appId, called.answered ? { answered: true } : called)
    return called
  }

  /** How many times each of its events was told in the minutes closed since a cursor, if it answers; recorded as any call. */
  @UseCase()
  async fetchMetrics(appId: string, since: string | null): Promise<Called<EventCounts>> {
    const called = await this.call(appId, endpoint => this.deps.client.metrics(endpoint, since))
    await this.record(appId, called.answered ? { answered: true } : called)
    return called
  }

  /** How long each of its use cases' calls took in the minutes closed since a cursor, if it answers; recorded as any call. */
  @UseCase()
  async fetchTimings(appId: string, since: string | null): Promise<Called<UseCaseTimings>> {
    const called = await this.call(appId, endpoint => this.deps.client.timings(endpoint, since))
    await this.record(appId, called.answered ? { answered: true } : called)
    return called
  }

  /** How its queues' jobs went in the minutes closed since a cursor, if it answers; recorded as any call. */
  @UseCase()
  async fetchFlows(appId: string, since: string | null): Promise<Called<QueueFlows>> {
    const called = await this.call(appId, endpoint => this.deps.client.flows(endpoint, since))
    await this.record(appId, called.answered ? { answered: true } : called)
    return called
  }

  /** Its instances and their servers now, and their minutes closed since a cursor, if it answers; recorded as any call. */
  @UseCase()
  async fetchInstances(appId: string, since: string | null): Promise<Called<Instances>> {
    const called = await this.call(appId, endpoint => this.deps.client.instances(endpoint, since))
    await this.record(appId, called.answered ? { answered: true } : called)
    return called
  }

  /** The traces it kept in the minutes closed since a cursor, if it answers; recorded as any call. */
  @UseCase()
  async fetchTraces(appId: string, since: string | null): Promise<Called<ClosedTraces>> {
    const called = await this.call(appId, endpoint => this.deps.client.traces(endpoint, since))
    await this.record(appId, called.answered ? { answered: true } : called)
    return called
  }

  /** How full its queues are now, if it answers; recorded as any call. */
  @UseCase()
  async fetchOutbox(appId: string): Promise<Called<OutboxState>> {
    const called = await this.call(appId, endpoint => this.deps.client.outbox(endpoint))
    await this.record(appId, called.answered ? { answered: true } : called)
    return called
  }

  /** A page of a context's dead jobs, if it answers: asked as someone looks, not recorded. */
  @UseCase()
  async fetchDeadJobs(appId: string, context: string, after: string | null, limit: number): Promise<Called<DeadJobs>> {
    return this.call(appId, endpoint => this.deps.client.deadJobs(endpoint, context, after, limit))
  }

  /**
   * Its counts as they come, straight from it: what it sends, passed on as it is, until
   * `signal` aborts. Not recorded: watching live is no check of whether it answers.
   */
  @UseCase()
  async live(appId: string, signal: AbortSignal): Promise<Called<ReadableStream<Uint8Array>>> {
    return this.call(appId, endpoint => this.deps.client.live(endpoint, signal))
  }

  /** Whether it answers, as last found: `unknown` until it is first asked. */
  @UseCase()
  async status(appId: string): Promise<ConnectionStatusDTO> {
    await this.deps.app.get(appId)
    const connection = await this.repo.first({ appId })
    if (!connection) return { appId, status: 'unknown', identity: null, failure: null, checkedAt: '', lastSeenAt: null }
    const { status, identity, failure, checkedAt, lastSeenAt } = connection.toDTO()
    return { appId, status, identity, failure, checkedAt, lastSeenAt }
  }

  /** Forgets everything of an application deleted: forgetting it twice is forgetting it once. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
  }

  /** Calls the application, signing with its key: what it answered, or why it did not. */
  private async call<T>(appId: string, ask: (endpoint: Endpoint) => Promise<T>): Promise<Called<T>> {
    try {
      return { answered: true, value: await ask(await this.deps.app.endpointOf(appId)) }
    } catch (error) {
      if (error instanceof AppCallFailed) return { answered: false, failure: { reason: error.reason, message: error.message } }
      if (error instanceof SealedKeyUnreadable) return { answered: false, failure: { reason: 'key_unreadable', message: error.message } }
      throw error
    }
  }

  /** Notes how a call went: not for an application deleted while it was called, whose connection is forgotten. */
  private async record(appId: string, outcome: Outcome): Promise<void> {
    const connection = await this.repo.first({ appId })
    if (connection) connection.record(outcome)
    await this.repo.persistWhileThere(appId, connection ?? Connection.first(appId, outcome), async () => await this.deps.app.find(appId) !== null)
  }
}
