import type { DomainEvent } from '../../../core/events/domain-event'
import type { UserDTO } from '../user.schema'

/** The whole user as they are now, and only the fields that changed. */
export class User_Updated implements DomainEvent<{ dto: UserDTO, changes: Partial<UserDTO> }> {
  static readonly eventName = 'user.updated'
  readonly name = User_Updated.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: { dto: UserDTO, changes: Partial<UserDTO> }) {}
}
