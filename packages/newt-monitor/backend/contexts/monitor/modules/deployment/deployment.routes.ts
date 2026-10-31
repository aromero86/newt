import { pageRequestFrom } from 'newt/http'
import type { MonitorBase } from '../../../../monitor-base'
import type { Deployment_Module } from './deployment.module'

export function registerDeploymentRoutes(base: MonitorBase, deployments: Deployment_Module): void {
  base.http.get('/apps/:id/deployments', async request => Response.json(await deployments.list(request.params.id, pageRequestFrom(request))))
}
