import type { Deployment_Deps } from './deployment.deps'
import type { Deployment_Module } from './deployment.module'

/**
 * A deployment is recorded as its first instance is heard of, and described once
 * recorded, or once its application says where its code is; forgotten with its
 * application. Describing asks GitHub: a job, asked again while GitHub does not answer.
 */
export function registerDeploymentWorkers(deployments: Deployment_Module, deps: Deployment_Deps): void {
  deps.instances.events.started.subscribe(started => deployments.record(started), {
    strategy: 'handler',
    queue: 'deployment.record.on.instances.started',
    when: started => started.commit !== null,
  })
  deployments.events.recorded.subscribe(deployment => deployments.describe(deployment.id), {
    strategy: 'handler',
    queue: 'deployment.describe.on.deployment.recorded',
  })
  deps.app.events.updated.subscribe(({ dto }) => deployments.describeAll(dto.id), {
    strategy: 'handler',
    queue: 'deployment.describeAll.on.app.updated',
    when: ({ changed }) => changed.includes('repository'),
  })
  deps.app.events.deleted.subscribe(app => deployments.forget(app.id), {
    strategy: 'handler',
    queue: 'deployment.forget.on.app.deleted',
  })
}
