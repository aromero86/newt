import { z } from 'zod'
import { Entity, now, SecretToken, type EntityInput } from 'newt-kit/core'
import { OauthGrant_Replayed } from './events/oauth-grant-replayed'
import { OauthGrantSchema, type OauthGrantStatus } from './oauth-grant.schema'

export * from './oauth-grant.schema'

/** The request as it is kept: what anyone sees, and the hash of the code it gave. */
const OauthGrantEntitySchema = OauthGrantSchema.extend({
  codeHash: z.string().nullable(),
})

export type OauthGrantEntityDTO = z.infer<typeof OauthGrantEntitySchema>

/** What a code starts with, so that people and secret scanners recognize it. */
const CODE_PREFIX = 'cooper_ac_'
/** How long a request waits for the person to answer. */
const REQUEST_MINUTES = 10
/** How long a client has to trade its code: it does so at once. */
const CODE_MINUTES = 5

const minutesFromNow = (minutes: number) => new Date(now().getTime() + minutes * 60_000).toISOString()

/**
 * A client asking a person for access, and their answer: from the request until the
 * client trades the code it got (OAuth 2.1, authorization code with PKCE). Only the
 * code's hash is kept.
 */
export class OauthGrant extends Entity<typeof OauthGrantEntitySchema, typeof OauthGrantSchema> {

  private constructor(input: EntityInput<OauthGrantEntityDTO>, isNew: boolean) {
    super(OauthGrantEntitySchema, input, isNew, OauthGrantSchema)
  }

  static fromDTO(dto: OauthGrantEntityDTO & { version: number }): OauthGrant {
    return new OauthGrant(dto, false)
  }

  /** A request checked against its client: it waits for the person's answer. */
  static request(input: { clientId: string, productId: string, redirectUri: string, codeChallenge: string, state: string | null, resource: string | null, firstParty: boolean }): OauthGrant {
    return new OauthGrant({ ...input, status: 'pending', userId: null, codeHash: null, expiresAt: minutesFromNow(REQUEST_MINUTES) }, true)
  }

  /** What the store keeps of a code; null when it cannot be one. */
  static hashOfCode(code: string): string | null {
    const parsed = SecretToken.schema.safeParse(code.startsWith(CODE_PREFIX) ? code.slice(CODE_PREFIX.length) : '')
    return parsed.success ? SecretToken.hash(parsed.data) : null
  }

  get status(): OauthGrantStatus {
    return this.data.status
  }

  get clientId(): string {
    return this.data.clientId
  }

  get productId(): string {
    return this.data.productId
  }

  get redirectUri(): string {
    return this.data.redirectUri
  }

  get state(): string | null {
    return this.data.state
  }

  get firstParty(): boolean {
    return this.data.firstParty
  }

  /** In the state it should be, and in time. */
  is(status: OauthGrantStatus, at = now()): boolean {
    return this.data.status === status && new Date(this.data.expiresAt) > at
  }

  /** The person said yes (or signed in to a product): the code only the client will hold. */
  approve(userId: string): string {
    const code = SecretToken.generate()
    this.change({ status: 'approved', userId, codeHash: SecretToken.hash(code), expiresAt: minutesFromNow(CODE_MINUTES) })
    return `${CODE_PREFIX}${code}`
  }

  deny(userId: string): void {
    this.change({ status: 'denied', userId })
  }

  /** PKCE (RFC 7636 §4.6): only who started the request knows the verifier. */
  isVerifiedBy(codeVerifier: string): boolean {
    return new Bun.CryptoHasher('sha256').update(codeVerifier).digest('base64url') === this.data.codeChallenge
  }

  /** The client traded its code: it opens nothing any more. */
  redeem(): void {
    this.change({ status: 'redeemed' })
  }

  /**
   * Its code was brought again after it was traded: someone copied it (RFC 6749
   * §4.1.2). Whatever it was traded for is revoked, from a worker.
   */
  replay(): void {
    this.change({ status: 'replayed' })
    this.trackEvent(new OauthGrant_Replayed(this.toDTO()))
  }
}
