import { now, type DomainEvent } from 'newt/core'
import type { OauthGrantDTO } from '../oauth-grant.schema'

/** A code was brought twice: someone copied it, and what it was traded for has to stop working. */
export class OauthGrant_Replayed implements DomainEvent<OauthGrantDTO> {
  static readonly eventName = 'oauthGrant.replayed'
  readonly name = OauthGrant_Replayed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: OauthGrantDTO) {}
}
