import { TableRepository } from 'newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { Deployment, type DeploymentDTO } from './deployment'

export type DeploymentRow = DeploymentDTO & { version: number }

export class Deployment_Repository extends TableRepository<Deployment, DeploymentRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. A deployment is its application's, by its id.
    super(base, base.store.table<DeploymentRow>('deployment'), { scope: 'none' })
  }

  protected toEntity(row: DeploymentRow): Deployment {
    return Deployment.fromDTO(row)
  }

  /**
   * Saves a deployment, a new one only if its commit is not already the application's:
   * two instances of one commit heard of at once make one deployment, the second save
   * running again to find the first.
   */
  async persistOnce(deployment: Deployment): Promise<void> {
    const { appId, commit } = deployment
    await this.save([deployment], each => this.write(each), {
      guard: [`deployment:${appId}:${commit}`],
      after: async () => {
        if (deployment.isNew && await this.count({ appId, commit }) > 1) this.conflict()
      },
    })
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
