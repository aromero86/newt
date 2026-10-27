import { eventsOf, Module, UseCase } from 'newt/core'
import type { ApplicationDescription, EventCounts } from 'newt/runtime'
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

  private async record(appId: string, outcome: Outcome): Promise<void> {
    const connection = await this.repo.first({ appId })
    if (connection) connection.record(outcome)
    await this.repo.persist(connection ?? Connection.first(appId, outcome))
  }
}
