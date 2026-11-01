import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { AppDTO } from '../app.schema'

export class App_Registered implements DomainEvent<AppDTO> {
  static readonly eventName = 'app.registered'
  readonly name = App_Registered.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: AppDTO) {}
}
