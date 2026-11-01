import { now, type DomainEvent } from 'newt-kit/core'
import type { AppUpdatedDTO } from '../app.schema'

export class App_Updated implements DomainEvent<AppUpdatedDTO> {
  static readonly eventName = 'app.updated'
  readonly name = App_Updated.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AppUpdatedDTO) {}
}
