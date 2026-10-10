import type { DomainEvent } from '../../../core/events/domain-event'
import type { UserDTO } from '../user.schema'

export class User_Created implements DomainEvent<UserDTO> {
  static readonly eventName = 'user.created'
  readonly name = User_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: UserDTO) {}
}
