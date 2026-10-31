import { currentActor, eventsOf, Module, now, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { OauthClientNotFound } from '../oauth-client/errors/oauth-client-not-found'
import type { OauthClientDTO } from '../oauth-client/oauth-client.schema'
import { AuthorizationNotFound } from './errors/authorization-not-found'
import { AuthorizationNotOpen } from './errors/authorization-not-open'
import { InvalidAuthorizationRequest } from './errors/invalid-authorization-request'
import { InvalidGrant } from './errors/invalid-grant'
import { OauthGrant_Replayed } from './events/oauth-grant-replayed'
import {
  OauthGrant,
  OauthGrantRedeemSchema,
  OauthGrantRequestSchema,
  type AuthorizationRequestProblem,
  type OauthGrantRedeemDTO,
  type OauthGrantRedeemedDTO,
  type OauthGrantRedirectDTO,
  type OauthGrantRequestDTO,
  type OauthGrantReviewDTO,
} from './oauth-grant'
import type { OauthGrant_Deps } from './oauth-grant.deps'
import type { OauthGrant_Options } from './oauth-grant-options'
import { OauthGrant_Repository } from './oauth-grant.repository'
import { registerOauthGrantRoutes } from './oauth-grant.routes'
import { registerOauthGrantWorkers } from './oauth-grant.workers'

/** A PKCE challenge of S256: the base64url of a SHA-256, 43 characters. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/** What a request that does not even parse lacks, by the field found wrong first. */
function problemOf(field: PropertyKey | undefined): AuthorizationRequestProblem {
  if (field === 'clientId') return 'oauthGrant.missing_client'
  if (field === 'redirectUri') return 'oauthGrant.missing_redirect'
  return 'oauthGrant.invalid_request'
}

/**
 * Authorization requests (OAuth 2.1, authorization code with PKCE): a client asks,
 * the person signs in to the monitor and answers on its consent page, and the client
 * gets a code it trades for tokens once (`token.exchange`).
 */
export class OauthGrant_Module extends Module {

  static initialize(base: AuthBase, deps: OauthGrant_Deps, options: OauthGrant_Options): OauthGrant_Module {
    const module = new OauthGrant_Module(base, new OauthGrant_Repository(base), deps, options)
    registerOauthGrantRoutes(base, module, options)
    registerOauthGrantWorkers(module)
    return module
  }

  readonly events
  /** At five past three every night (UTC): a schedule, told as an event its workers subscribe to. */
  readonly nightly

  private constructor(base: AuthBase, private readonly repo: OauthGrant_Repository, private readonly deps: OauthGrant_Deps, private readonly options: OauthGrant_Options) {
    super('oauthGrant', base.invocations, deps)
    this.events = eventsOf(base.bus, { replayed: OauthGrant_Replayed })
    this.nightly = base.schedules.define('oauthGrant.nightly', '5 3 * * *')
  }

  /**
   * A client asks for access: the request, checked against the client, waits for the
   * person's answer. Until the client and its redirect address are known to go
   * together, nothing is sent back to that address.
   */
  @UseCase()
  async request(input: OauthGrantRequestDTO): Promise<{ id: string }> {
    const parsed = OauthGrantRequestSchema.safeParse(input)
    if (!parsed.success) throw new InvalidAuthorizationRequest(problemOf(parsed.error.issues[0]?.path[0]))
    const request = parsed.data
    const client = await this.clientOf(request.clientId)
    if (!client.redirectUris.includes(request.redirectUri)) throw new InvalidAuthorizationRequest('oauthGrant.redirect_mismatch')
    if (request.responseType !== 'code') throw new InvalidAuthorizationRequest('oauthGrant.unsupported_response_type')
    if (request.codeChallengeMethod !== 'S256' || !S256_CHALLENGE.test(request.codeChallenge)) {
      throw new InvalidAuthorizationRequest('oauthGrant.pkce_required')
    }
    // The monitor has one server to give access to: one that says another asks for what it does not have.
    if (request.resource !== undefined && request.resource !== this.options.resource) {
      throw new InvalidAuthorizationRequest('oauthGrant.unknown_resource')
    }

    const grant = OauthGrant.request({
      clientId: client.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      state: request.state ?? null,
      resource: this.options.resource,
    })
    await this.repo.persist(grant)
    return { id: grant.id }
  }

  /** What the consent page shows of a request: who asks, and where the browser goes back to. */
  @UseCase()
  async review(id: string): Promise<OauthGrantReviewDTO> {
    const grant = await this.load(id)
    const client = await this.deps.oauthClient.get(grant.clientId)
    return { id: grant.id, clientName: client.name, redirectHost: new URL(grant.redirectUri).host, open: grant.is('pending') }
  }

  /** The signed-in person says yes: the browser goes back to the client with a code. */
  @UseCase()
  async approve(id: string): Promise<OauthGrantRedirectDTO> {
    const grant = await this.load(id)
    if (!grant.is('pending')) throw new AuthorizationNotOpen()
    const code = grant.approve(currentActor().userId)
    await this.repo.persist(grant)
    return { redirectTo: this.redirect(grant, { code }) }
  }

  /** The signed-in person says no: the browser goes back to the client empty-handed. */
  @UseCase()
  async deny(id: string): Promise<OauthGrantRedirectDTO> {
    const grant = await this.load(id)
    if (!grant.is('pending')) throw new AuthorizationNotOpen()
    grant.deny(currentActor().userId)
    await this.repo.persist(grant)
    return { redirectTo: this.redirect(grant, { error: 'access_denied' }) }
  }

  /**
   * The client trades its code, once: `token.exchange` calls it once it knows the
   * client. A code brought again after it was traded was copied: the grant is marked
   * replayed, and its worker revokes the tokens it gave.
   */
  @UseCase()
  async redeem(input: OauthGrantRedeemDTO): Promise<OauthGrantRedeemedDTO> {
    const { code, codeVerifier, clientId, redirectUri } = OauthGrantRedeemSchema.parse(input)
    const codeHash = OauthGrant.hashOfCode(code)
    const grant = codeHash ? await this.repo.first({ codeHash }) : undefined
    if (!grant) throw new InvalidGrant()
    if (grant.status === 'redeemed') {
      grant.replay()
      await this.repo.persist(grant)
      throw new InvalidGrant()
    }
    if (!grant.is('approved') || grant.clientId !== clientId || grant.redirectUri !== redirectUri || !grant.isVerifiedBy(codeVerifier)) throw new InvalidGrant()

    grant.redeem()
    await this.repo.persist(grant)
    const { id, userId, resource } = grant.toDTO()
    return { grantId: id, userId: userId!, clientId, resource }
  }

  /**
   * Removes the requests nobody will finish: unanswered, denied or approved, past their
   * time. Redeemed ones stay, so a code brought again is still seen as copied. What the
   * nightly worker calls; the second time, there are none.
   */
  @UseCase()
  async purgeExpired(): Promise<number> {
    return this.repo.purgeExpired(now())
  }

  private load(id: string): Promise<OauthGrant> {
    return this.resolve(() => this.repo.find({ id }), () => new AuthorizationNotFound(id))
  }

  private async clientOf(clientId: string): Promise<OauthClientDTO> {
    try {
      return await this.deps.oauthClient.get(clientId)
    } catch (error) {
      if (error instanceof OauthClientNotFound) throw new InvalidAuthorizationRequest('oauthGrant.unknown_client')
      throw error
    }
  }

  /** The client's redirect address with the answer, and the state it sent, back. */
  private redirect(grant: OauthGrant, params: Record<string, string>): string {
    const url = new URL(grant.redirectUri)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    if (grant.state !== null) url.searchParams.set('state', grant.state)
    return url.toString()
  }
}
