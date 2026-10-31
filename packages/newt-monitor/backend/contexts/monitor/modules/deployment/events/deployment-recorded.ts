import { now, type DomainEvent } from 'newt/core'
import type { DeploymentRecordedDTO } from '../deployment.schema'

export class Deployment_Recorded implements DomainEvent<DeploymentRecordedDTO> {
  static readonly eventName = 'deployment.recorded'
  readonly name = Deployment_Recorded.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: DeploymentRecordedDTO) {}
}
