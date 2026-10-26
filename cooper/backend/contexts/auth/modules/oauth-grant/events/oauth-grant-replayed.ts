import { now, type DomainEvent } from 'newt/core'
import type { OauthGrantDTO } from '../oauth-grant.schema'

/** A code was brought again after it was traded: the tokens it gave are to be revoked. */
export class OauthGrant_Replayed implements DomainEvent<OauthGrantDTO> {
  static readonly eventName = 'oauthGrant.replayed'
  readonly name = OauthGrant_Replayed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: OauthGrantDTO) {}
}
