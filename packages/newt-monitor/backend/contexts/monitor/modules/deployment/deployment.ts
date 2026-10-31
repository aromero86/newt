import { Entity, type EntityInput } from 'newt/core'
import type { CommitMessage } from '../../../../shared/commit-messages/commit-messages'
import { DeploymentSchema, type DeploymentDTO } from './deployment.schema'
import { Deployment_Recorded } from './events/deployment-recorded'

export * from './deployment.schema'

/** A commit an application deployed, once: each instance built from it after the first is the same deployment. */
export class Deployment extends Entity<typeof DeploymentSchema> {

  private constructor(input: EntityInput<DeploymentDTO>, isNew: boolean) {
    super(DeploymentSchema, input, isNew)
  }

  static fromDTO(dto: DeploymentDTO & { version: number }): Deployment {
    return new Deployment(dto, false)
  }

  /** Its first instance heard of. */
  static record(appId: string, commit: string, deployedAt: string): Deployment {
    const deployment = new Deployment({ appId, commit, title: null, description: null, deployedAt }, true)
    deployment.trackEvent(new Deployment_Recorded(deployment.toDTO()))
    return deployment
  }

  get appId(): string {
    return this.data.appId
  }

  get commit(): string {
    return this.data.commit
  }

  get title(): string | null {
    return this.data.title
  }

  /** Another of its instances: one that started before the first heard of moves when it was deployed back. */
  startedAgain(startedAt: string): void {
    if (startedAt < this.data.deployedAt) this.change({ deployedAt: startedAt })
  }

  /** Its message, as its repository tells it. */
  described({ title, description }: CommitMessage): void {
    if (title !== this.data.title || description !== this.data.description) this.change({ title, description })
  }
}
