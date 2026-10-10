import type { DomainEvent } from '../../../core/events/domain-event'
import type { AuthCredentialChangedPayload } from '../auth-credential.schema'

export class AuthCredential_Changed implements DomainEvent<AuthCredentialChangedPayload> {
  static readonly eventName = 'authCredential.changed'
  readonly name = AuthCredential_Changed.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: AuthCredentialChangedPayload) {}
}
