import type { DomainEvent } from '../../../core/events/domain-event'
import type { CredentialChangedPayload } from '../credential.schema'

export class Credential_Changed implements DomainEvent<CredentialChangedPayload> {
  static readonly eventName = 'credential.changed'
  readonly name = Credential_Changed.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CredentialChangedPayload) {}
}
