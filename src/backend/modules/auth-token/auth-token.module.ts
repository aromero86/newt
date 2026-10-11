import type { Base } from '../../base/base'
import type { Actor } from '../../core/context/actor'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { AuthToken, AuthTokenCreateSchema, type AuthTokenCreateDTO, type AuthTokenCreatedDTO, type AuthTokenDTO } from './auth-token'
import { AuthToken_Repository } from './auth-token.repository'
import { registerAuthTokenRoutes } from './auth-token.routes'
import { AuthTokenNotFound } from './errors/auth-token-not-found'

/**
 * Access tokens: how an AI assistant, or anything outside the browser, acts for a
 * person. Each person makes and revokes their own.
 */
export class AuthToken_Module extends Module {

  static async initialize(base: Base) {
    const module = new AuthToken_Module(base, new AuthToken_Repository(base))
    registerAuthTokenRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: AuthToken_Repository) {
    super('authToken', base.transactions)
  }

  /** A page of the signed-in person's tokens, newest first. */
  @UseCase('authToken.list')
  async list(page: PageRequest): Promise<Page<AuthTokenDTO>> {
    const tokens = await this.repo.page(currentActor().userId, page)
    return { ...tokens, items: tokens.items.map(token => this.contract(token)) }
  }

  /** A new token for the signed-in person, with its secret: the only time it is seen. */
  @UseCase('authToken.create')
  async create(input: AuthTokenCreateDTO): Promise<AuthTokenCreatedDTO> {
    const { name } = AuthTokenCreateSchema.parse(input)
    const { token, secret } = AuthToken.create(currentActor().userId, name)
    await this.repo.persist(token)
    return { token: this.contract(token), secret }
  }

  /** From then on, it opens nothing. */
  @UseCase('authToken.revoke')
  async revoke(tokenId: string): Promise<void> {
    const { userId } = currentActor()
    await this.resolve(() => this.repo.find({ id: [tokenId], userId }), () => new AuthTokenNotFound(tokenId))
    await this.repo.delete({ id: [tokenId] })
  }

  /** Who a secret acts for, noting when it was used; null when it opens nothing. */
  @UseCase('authToken.authenticate')
  async authenticate(secret: string | null | undefined): Promise<Actor | null> {
    const tokenHash = secret ? AuthToken.hashOf(secret) : null
    if (!tokenHash) return null
    const [token] = await this.repo.find({ tokenHash })
    if (!token) return null
    token.used()
    await this.repo.persist(token)
    return { userId: token.userId, sessionId: null }
  }

  private contract(token: AuthToken): AuthTokenDTO {
    const { id, name, lastUsedAt, createdAt } = token.toDTO()
    return { id, name, lastUsedAt, createdAt }
  }
}
