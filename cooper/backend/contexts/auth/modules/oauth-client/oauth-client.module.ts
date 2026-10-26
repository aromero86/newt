import { Module, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { InvalidClient } from './errors/invalid-client'
import { OauthClientNotFound } from './errors/oauth-client-not-found'
import { OauthClient, OauthClientRegisterSchema, type OauthClientDTO } from './oauth-client'
import type { OauthClient_Deps } from './oauth-client.deps'
import type { OauthClient_Options } from './oauth-client-options'
import { OauthClient_Repository } from './oauth-client.repository'
import { registerOauthClientRoutes } from './oauth-client.routes'
import { ClientSecret } from './value-objects/client-secret'

/**
 * The OAuth clients: each product's own, a confidential web client declared with the
 * product, and the MCP clients that register themselves (RFC 7591) to ask people for
 * access to a product's MCP server.
 */
export class OauthClient_Module extends Module {

  static initialize(base: AuthBase, deps: OauthClient_Deps, options: OauthClient_Options): OauthClient_Module {
    const module = new OauthClient_Module(base, new OauthClient_Repository(base), deps, options)
    registerOauthClientRoutes(base, module)
    return module
  }

  private constructor(
    base: AuthBase,
    private readonly repo: OauthClient_Repository,
    private readonly deps: OauthClient_Deps,
    private readonly options: OauthClient_Options,
  ) {
    super('oauthClient', base.invocations)
  }

  /** Anyone may register a client: it opens nothing until a person says yes to it. */
  @UseCase()
  async register(input: unknown): Promise<OauthClientDTO> {
    const client = OauthClient.register(OauthClientRegisterSchema.parse(input))
    await this.repo.persist(client)
    return client.toDTO()
  }

  /**
   * Each product's own client, as the product and the configuration say now: made the
   * first time auth starts, kept in step after. Safe to run on every start.
   */
  @UseCase()
  async declareProducts(): Promise<OauthClientDTO[]> {
    const clients: OauthClient[] = []
    for (const product of await this.deps.product.list()) {
      const secret = ClientSecret.from(this.options.secrets[product.id] ?? '')
      const declared = { name: product.name, redirectUri: product.redirectUri, secret }
      const existing = await this.repo.first({ clientId: product.id })
      if (existing) existing.reconfigure(declared)
      clients.push(existing ?? OauthClient.forProduct({ productId: product.id, ...declared }))
    }
    await this.repo.persist(...clients)
    return clients.map(client => client.toDTO())
  }

  @UseCase()
  async get(clientId: string): Promise<OauthClientDTO> {
    return (await this.load(clientId)).toDTO()
  }

  /**
   * The client that sent a request to the token endpoint, if it proves it is that one:
   * a confidential client with its secret, a public one with none (its proof is PKCE).
   */
  @UseCase()
  async authenticate(clientId: string, secret: string | undefined): Promise<OauthClientDTO> {
    const client = await this.repo.first({ clientId })
    if (!client || !client.accepts(secret)) throw new InvalidClient()
    return client.toDTO()
  }

  private load(clientId: string): Promise<OauthClient> {
    return this.resolve(() => this.repo.find({ clientId }), () => new OauthClientNotFound(clientId))
  }
}
