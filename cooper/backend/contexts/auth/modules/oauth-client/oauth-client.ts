import { z } from 'zod'
import { Entity, type EntityInput } from 'newt-kit/core'
import { OauthClientSchema } from './oauth-client.schema'
import { ClientSecret } from './value-objects/client-secret'

export * from './oauth-client.schema'

/** The client as it is kept: what anyone sees, and its secret's hash when it has one. */
const OauthClientEntitySchema = OauthClientSchema.extend({
  /** A confidential client's secret, hashed; null for a public one, which only has PKCE. */
  secretHash: z.string().nullable(),
})

export type OauthClientEntityDTO = z.infer<typeof OauthClientEntitySchema>

/** What a client is called when it does not say. */
const UNNAMED = 'An unnamed application'

/**
 * An application that asks people for access. A product's own is confidential and
 * follows the product as cooper's code declares it; one that registered itself (an
 * MCP client) is public and does not change.
 */
export class OauthClient extends Entity<typeof OauthClientEntitySchema, typeof OauthClientSchema> {

  private constructor(input: EntityInput<OauthClientEntityDTO>, isNew: boolean) {
    super(OauthClientEntitySchema, input, isNew, OauthClientSchema)
  }

  static fromDTO(dto: OauthClientEntityDTO & { version: number }): OauthClient {
    return new OauthClient(dto, false)
  }

  /** A client that registered itself (RFC 7591): its `client_id` is its own id. */
  static register(input: { name?: string | undefined, redirectUris: string[] }): OauthClient {
    const id = Bun.randomUUIDv7()
    return new OauthClient({ id, clientId: id, name: input.name || UNNAMED, redirectUris: [...new Set(input.redirectUris)], productId: null, secretHash: null }, true)
  }

  /** A product's own client, the first time auth starts with it: its `client_id` is the product's id. */
  static forProduct(input: { productId: string, name: string, redirectUri: string, secret: ClientSecret }): OauthClient {
    const { productId, name, redirectUri, secret } = input
    return new OauthClient({ clientId: productId, name, redirectUris: [redirectUri], productId, secretHash: ClientSecret.hash(secret) }, true)
  }

  get clientId(): string {
    return this.data.clientId
  }

  get confidential(): boolean {
    return this.data.secretHash !== null
  }

  /** A product's own client follows the product: its name, where it gets its codes, its secret. */
  reconfigure(input: { name: string, redirectUri: string, secret: ClientSecret }): void {
    const secretHash = this.data.secretHash !== null && ClientSecret.matches(input.secret, this.data.secretHash) ? this.data.secretHash : ClientSecret.hash(input.secret)
    this.change({ name: input.name, redirectUris: [input.redirectUri], secretHash })
  }

  /** A confidential client proves itself with its secret; a public one sends none. */
  accepts(secret: string | undefined): boolean {
    if (this.data.secretHash === null) return secret === undefined
    return secret !== undefined && ClientSecret.matches(secret, this.data.secretHash)
  }
}
