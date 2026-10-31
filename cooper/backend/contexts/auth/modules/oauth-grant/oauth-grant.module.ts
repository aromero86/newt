import { currentActor, eventsOf, findCurrentActor, Module, now, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { OauthClientNotFound } from '../oauth-client/errors/oauth-client-not-found'
import type { OauthClientDTO } from '../oauth-client/oauth-client.schema'
import type { ProductDTO } from '../product/product.schema'
import { AuthorizationNotFound } from './errors/authorization-not-found'
import { AuthorizationNotOpen } from './errors/authorization-not-open'
import { InvalidAuthorizationRequest } from './errors/invalid-authorization-request'
import { InvalidGrant } from './errors/invalid-grant'
import { NoProductAccess } from './errors/no-product-access'
import { OauthGrant_Replayed } from './events/oauth-grant-replayed'
import {
  OauthGrant,
  OauthGrantRedeemSchema,
  OauthGrantRequestSchema,
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

/**
 * Authorization requests (OAuth 2.1, authorization code with PKCE): a client asks,
 * the person signs in and answers in auth's UI, and the client gets a code it trades
 * for tokens once (`token.exchange`). A product's own client signs the person in: the
 * UI says yes for them. Any other (an MCP client) asks for their consent.
 */
export class OauthGrant_Module extends Module {

  static initialize(base: AuthBase, deps: OauthGrant_Deps, options: OauthGrant_Options): OauthGrant_Module {
    const module = new OauthGrant_Module(base, new OauthGrant_Repository(base), deps)
    registerOauthGrantRoutes(base, module, deps, options)
    registerOauthGrantWorkers(module)
    return module
  }

  readonly events

  /** At three every night (UTC): a schedule, told as an event its workers subscribe to. */
  readonly nightly

  private constructor(base: AuthBase, private readonly repo: OauthGrant_Repository, private readonly deps: OauthGrant_Deps) {
    super('oauthGrant', base.invocations, deps)
    this.events = eventsOf(base.bus, { replayed: OauthGrant_Replayed })
    this.nightly = base.schedules.define('oauthGrant.nightly', '0 3 * * *')
  }

  /**
   * A client asks for access: the request, checked against the client, waits for the
   * person's answer. Until the client and its redirect address are known to go
   * together, nothing is sent back to that address.
   */
  @UseCase()
  async request(input: OauthGrantRequestDTO): Promise<{ id: string }> {
    const parsed = OauthGrantRequestSchema.safeParse(input)
    if (!parsed.success) throw new InvalidAuthorizationRequest(parsed.error.issues[0]?.message ?? 'The request is not a valid one')
    const request = parsed.data
    const client = await this.clientOf(request.clientId)
    if (!client.redirectUris.includes(request.redirectUri)) throw new InvalidAuthorizationRequest('The address to go back to is not one of this application')
    if (request.responseType !== 'code') throw new InvalidAuthorizationRequest('The application asks for a kind of access cooper does not give')
    if (request.codeChallengeMethod !== 'S256' || !S256_CHALLENGE.test(request.codeChallenge)) {
      throw new InvalidAuthorizationRequest('The application does not protect its request with PKCE (S256)')
    }

    // A product's own client signs people in to it; any other reaches a product's MCP server.
    const product = client.productId !== null ? await this.deps.product.get(client.productId) : await this.deps.product.forResource(request.resource)
    if (!product) throw new InvalidAuthorizationRequest('The application asks for access to a server cooper does not have')

    const grant = OauthGrant.request({
      clientId: client.clientId,
      productId: product.id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      state: request.state ?? null,
      resource: client.productId !== null ? null : product.mcpResource,
      firstParty: client.productId !== null,
    })
    await this.repo.persist(grant)
    return { id: grant.id }
  }

  /**
   * What auth's UI shows of a request: to anyone with its address, signed in or not.
   * To someone signed in whom the product will not let in, it says so upfront
   * (`refused`), as `approve` would: the UI shows why, instead of asking.
   */
  @UseCase()
  async review(id: string): Promise<OauthGrantReviewDTO> {
    const grant = await this.load(id)
    const client = await this.deps.oauthClient.get(grant.clientId)
    const product = await this.deps.product.get(grant.productId)
    const { id: productId, name, signUp } = product
    // Who is signed in, if anyone: a public route runs as someone only when they are.
    const userId = findCurrentActor()?.userId ?? null
    const refused = userId !== null && !(await this.mayEnter(userId, product)) ? new NoProductAccess(name) : null
    return {
      id: grant.id,
      clientName: client.name,
      product: { id: productId, name, signUp },
      firstParty: grant.firstParty,
      redirectHost: new URL(grant.redirectUri).host,
      open: grant.is('pending'),
      refused: refused && { code: refused.code, message: refused.message },
    }
  }

  /**
   * The signed-in person says yes (or, for a product's own client, signs in): the
   * browser goes back to the client with a code. A product that lets in only whom it
   * was told checks the person was.
   */
  @UseCase()
  async approve(id: string): Promise<OauthGrantRedirectDTO> {
    const { userId } = currentActor()
    const grant = await this.load(id)
    if (!grant.is('pending')) throw new AuthorizationNotOpen()
    const product = await this.deps.product.get(grant.productId)
    if (!(await this.mayEnter(userId, product))) throw new NoProductAccess(product.name)

    const code = grant.approve(userId)
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
    const { id, userId, productId, resource } = grant.toDTO()
    return { grantId: id, userId: userId!, clientId, productId, resource }
  }

  /**
   * Whether a grant's code was brought again after it was traded: what `token.exchange`
   * asks once its tokens are saved, should the copy have come before they were.
   */
  @UseCase()
  async isReplayed(grantId: string): Promise<boolean> {
    const grant = await this.repo.first({ id: grantId })
    return grant?.status === 'replayed'
  }

  /**
   * Removes the requests that expired unanswered or untraded: anyone may ask, so they
   * would pile up. A redeemed one stays, which tells a copied code. What the nightly
   * worker calls; the second time, there are none.
   */
  @UseCase()
  async purgeExpired(): Promise<number> {
    return this.repo.purgeExpired(now())
  }

  /** A product that lets in only whom it was told lets in those with access to all of it. */
  private async mayEnter(userId: string, product: ProductDTO): Promise<boolean> {
    return product.access !== 'granted' || (await this.deps.access.check(userId, product.id, null)) !== null
  }

  private load(id: string): Promise<OauthGrant> {
    return this.resolve(() => this.repo.find({ id }), () => new AuthorizationNotFound(id))
  }

  private async clientOf(clientId: string): Promise<OauthClientDTO> {
    try {
      return await this.deps.oauthClient.get(clientId)
    } catch (error) {
      if (error instanceof OauthClientNotFound) throw new InvalidAuthorizationRequest('This application is not registered in cooper')
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
