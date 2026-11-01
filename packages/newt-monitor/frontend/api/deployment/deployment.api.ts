import type { Page } from '@newt-kit/newt/contract'
import type { DeploymentDTO } from '../../../backend/contexts/monitor/modules/deployment/deployment.schema'
import { type PageRequest, Requester } from '@newt-kit/react'

/** The monitor's `deployment` module: each commit an application deployed. */
export class DeploymentApi extends Requester {
  protected readonly path = '/apps'

  /** Its deployments, the newest first. */
  list(appId: string, page?: PageRequest) {
    return this.get<Page<DeploymentDTO>>(`/${appId}/deployments`, page)
  }
}
