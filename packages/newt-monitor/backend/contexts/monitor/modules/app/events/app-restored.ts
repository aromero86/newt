import { now, type DomainEvent } from 'newt-kit/core'
import type { AppDTO } from '../app.schema'

export class App_Restored implements DomainEvent<AppDTO> {
  static readonly eventName = 'app.restored'
  readonly name = App_Restored.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AppDTO) {}
}
