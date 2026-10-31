import { Module, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { InvalidClient } from './errors/invalid-client'
import { OauthClientNotFound } from './errors/oauth-client-not-found'
import { OauthClient, OauthClientRegisterSchema, type OauthClientDTO } from './oauth-client'
import { OauthClient_Repository } from './oauth-client.repository'
import { registerOauthClientRoutes } from './oauth-client.routes'

/** The OAuth clients: the MCP clients that register themselves (RFC 7591) to ask for access to the monitor's MCP server. */
export class OauthClient_Module extends Module {

  static initialize(base: AuthBase): OauthClient_Module {
    const module = new OauthClient_Module(base, new OauthClient_Repository(base))
    registerOauthClientRoutes(base, module)
    return module
  }

  private constructor(base: AuthBase, private readonly repo: OauthClient_Repository) {
    super('oauthClient', base.invocations, {})
  }

  /** Anyone may register a client: it opens nothing until the person says yes to it. */
  @UseCase()
  async register(input: unknown): Promise<OauthClientDTO> {
    const client = OauthClient.register(OauthClientRegisterSchema.parse(input))
    await this.repo.persist(client)
    return client.toDTO()
  }

  @UseCase()
  async get(clientId: string): Promise<OauthClientDTO> {
    return (await this.resolve(() => this.repo.find({ clientId }), () => new OauthClientNotFound(clientId))).toDTO()
  }

  /** The client that sent a request to the token endpoint, if it is one: public, it sends no secret (its proof is PKCE). */
  @UseCase()
  async authenticate(clientId: string, secret: string | undefined): Promise<OauthClientDTO> {
    const client = await this.repo.first({ clientId })
    if (!client || secret !== undefined) throw new InvalidClient()
    return client.toDTO()
  }
}
