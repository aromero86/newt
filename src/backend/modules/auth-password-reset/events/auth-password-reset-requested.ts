import type { DomainEvent } from '../../../core/events/domain-event'
import type { AuthPasswordResetRequestedPayload } from '../auth-password-reset.schema'

export class AuthPasswordReset_Requested implements DomainEvent<AuthPasswordResetRequestedPayload> {
  static readonly eventName = 'authPasswordReset.requested'
  readonly name = AuthPasswordReset_Requested.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: AuthPasswordResetRequestedPayload) {}
}
