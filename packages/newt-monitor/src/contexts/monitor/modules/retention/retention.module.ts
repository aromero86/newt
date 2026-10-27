import { Module, UseCase } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { Retention, RetentionChangeSchema, type RetentionDTO } from './retention'
import type { Retention_Deps } from './retention.deps'
import { Retention_Repository } from './retention.repository'
import { registerRetentionRoutes } from './retention.routes'
import { registerRetentionWorkers } from './retention.workers'

/**
 * How long the monitor keeps each application's metrics: the days of minutes, with who
 * did what, the days of daily summaries, and the days of traces. Every metrics module forgets its own as it
 * says, each night.
 */
export class Retention_Module extends Module {

  static initialize(base: MonitorBase, deps: Retention_Deps): Retention_Module {
    const module = new Retention_Module(base, new Retention_Repository(base), deps)
    registerRetentionRoutes(base, module)
    registerRetentionWorkers(module, deps)
    return module
  }

  private constructor(base: MonitorBase, private readonly repo: Retention_Repository, private readonly deps: Retention_Deps) {
    super('retention', base.invocations, deps)
  }

  /** How long its metrics are kept: the default until it is changed. */
  @UseCase()
  async of(appId: string): Promise<RetentionDTO> {
    return (await this.retentionOf(appId)).days
  }

  /** Its retention, for a client: a 404 for no such application. */
  @UseCase()
  async get(appId: string): Promise<RetentionDTO> {
    await this.deps.app.get(appId)
    return this.of(appId)
  }

  /** Changes how long its metrics are kept: what is older goes at the next nightly keep. */
  @UseCase()
  async change(appId: string, input: unknown): Promise<RetentionDTO> {
    await this.deps.app.get(appId)
    const change = RetentionChangeSchema.parse(input)
    const retention = await this.retentionOf(appId)
    retention.keep(change)
    await this.repo.persist(retention)
    return retention.days
  }

  /** Forgets it, its application deleted: forgetting it twice is forgetting it once. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
  }

  private async retentionOf(appId: string): Promise<Retention> {
    return await this.repo.first({ appId }) ?? Retention.byDefault(appId)
  }
}
