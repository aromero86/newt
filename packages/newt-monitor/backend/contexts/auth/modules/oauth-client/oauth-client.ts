import { Entity, type EntityInput } from 'newt-kit/core'
import { OauthClientSchema, type OauthClientDTO } from './oauth-client.schema'

export * from './oauth-client.schema'

/** What a client is called when it does not say. */
const UNNAMED = 'An unnamed application'

/** An application that asks the monitor's person for access: one that registered itself, and does not change. */
export class OauthClient extends Entity<typeof OauthClientSchema> {

  private constructor(input: EntityInput<OauthClientDTO>, isNew: boolean) {
    super(OauthClientSchema, input, isNew)
  }

  static fromDTO(dto: OauthClientDTO & { version: number }): OauthClient {
    return new OauthClient(dto, false)
  }

  /** A client that registered itself (RFC 7591): its `client_id` is its own id. */
  static register(input: { name?: string | undefined, redirectUris: string[] }): OauthClient {
    const id = Bun.randomUUIDv7()
    return new OauthClient({ id, clientId: id, name: input.name || UNNAMED, redirectUris: [...new Set(input.redirectUris)] }, true)
  }

  get clientId(): string {
    return this.data.clientId
  }
}
