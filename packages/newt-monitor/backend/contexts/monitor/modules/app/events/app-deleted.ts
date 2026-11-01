import { now, type DomainEvent } from 'newt-kit/core'
import type { AppDeletedDTO } from '../app.schema'

export class App_Deleted implements DomainEvent<AppDeletedDTO> {
  static readonly eventName = 'app.deleted'
  readonly name = App_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AppDeletedDTO) {}
}
