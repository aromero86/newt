import { now, type DomainEvent } from 'newt/core'
import type { AppDTO } from '../app.schema'

export class App_Archived implements DomainEvent<AppDTO> {
  static readonly eventName = 'app.archived'
  readonly name = App_Archived.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AppDTO) {}
}
