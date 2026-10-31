import { now, type DomainEvent } from 'newt/core'
import type { InstanceStartedDTO } from '../instances.schema'

export class Instances_Started implements DomainEvent<InstanceStartedDTO> {
  static readonly eventName = 'instances.started'
  readonly name = Instances_Started.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: InstanceStartedDTO) {}
}
