import { Module, now, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { InvalidRefreshToken } from './errors/invalid-refresh-token'
import {
  Token,
  TokenExchangeSchema,
  TokenRefreshSchema,
  TokenRevokeSchema,
  type TokenExchangeDTO,
  type TokenPairDTO,
  type TokenRefreshDTO,
  type TokenRevokeDTO,
  type TokenVerifiedDTO,
} from './token'
import type { Token_Deps } from './token.deps'
import type { Token_Options } from './token-options'
import { Token_Repository } from './token.repository'
import { registerTokenRoutes } from './token.routes'
import { registerTokenWorkers } from './token.workers'

/**
 * The tokens clients act with: an access token, opaque, which any context verifies
 * here (`verify`), and a refresh token that gets new ones. A product's web app trades
 * its code for them to learn who signed in; an MCP client acts with them.
 */
export class Token_Module extends Module {

  static initialize(base: AuthBase, deps: Token_Deps, options: Token_Options): Token_Module {
    const module = new Token_Module(base, new Token_Repository(base), deps, options)
    registerTokenRoutes(base, module)
    registerTokenWorkers(module, deps)
    return module
  }

  /** At three every night (UTC): a schedule, told as an event its workers subscribe to. */
  readonly nightly

  private constructor(
    base: AuthBase,
    private readonly repo: Token_Repository,
    private readonly deps: Token_Deps,
    private readonly options: Token_Options,
  ) {
    super('token', base.invocations, deps)
    this.nightly = base.schedules.define('token.nightly', '0 3 * * *')
  }

  /**
   * A client trades its code for tokens. It writes to `oauthGrant` without being a
   * worker, on purpose: the client waits for its tokens in this answer. The code is
   * spent first, then the tokens saved; should that fail, the client signs the person
   * in again. It never runs again on a conflict: the code it spent would look copied.
   */
  @UseCase({ writesTo: ['oauthGrant'], retryOnConflict: false })
  async exchange(input: TokenExchangeDTO): Promise<TokenPairDTO> {
    const { clientId, clientSecret, code, codeVerifier, redirectUri } = TokenExchangeSchema.parse(input)
    const client = await this.deps.oauthClient.authenticate(clientId, clientSecret)
    const grant = await this.deps.oauthGrant.redeem({ code, codeVerifier, clientId: client.clientId, redirectUri })

    const { token, pair } = Token.issue(grant, this.options)
    await this.repo.persist(token)
    return pair
  }

  /**
   * New tokens for a refresh token, which is replaced (OAuth 2.1 §4.3.1). The one it
   * replaced, brought again, was copied: the tokens are revoked.
   */
  @UseCase()
  async refresh(input: TokenRefreshDTO): Promise<TokenPairDTO> {
    const { clientId, clientSecret, refreshToken } = TokenRefreshSchema.parse(input)
    const client = await this.deps.oauthClient.authenticate(clientId, clientSecret)
    const hash = Token.hashOf('refresh', refreshToken)
    if (!hash) throw new InvalidRefreshToken()

    const token = await this.repo.first({ refreshTokenHash: hash })
    if (!token) {
      const copied = await this.repo.first({ previousRefreshTokenHash: hash })
      if (copied) {
        copied.revoke()
        await this.repo.persist(copied)
      }
      throw new InvalidRefreshToken()
    }
    if (token.clientId !== client.clientId || !token.isRefreshValid()) throw new InvalidRefreshToken()

    const pair = token.rotate(this.options)
    await this.repo.persist(token)
    return pair
  }

  /**
   * Who an access token acts for, and for which client, product and server; null when
   * it opens nothing. What every context asks before letting a request in with one.
   */
  @UseCase()
  async verify(accessToken: string): Promise<TokenVerifiedDTO | null> {
    const hash = Token.hashOf('access', accessToken)
    const token = hash ? await this.repo.first({ accessTokenHash: hash }) : undefined
    return token?.isAccessValid() ? token.verified() : null
  }

  /**
   * A client gives a token back (RFC 7009): its access or its refresh token, either
   * revokes both. A token that is not one, or not its own, is answered the same.
   */
  @UseCase()
  async revoke(input: TokenRevokeDTO): Promise<void> {
    const { clientId, clientSecret, token: value } = TokenRevokeSchema.parse(input)
    const client = await this.deps.oauthClient.authenticate(clientId, clientSecret)
    const access = Token.hashOf('access', value)
    const refresh = Token.hashOf('refresh', value)
    const token = access ? await this.repo.first({ accessTokenHash: access }) : refresh ? await this.repo.first({ refreshTokenHash: refresh }) : undefined
    if (!token || token.clientId !== client.clientId) return
    token.revoke()
    await this.repo.persist(token)
  }

  /** The tokens of a grant whose code was copied: what its worker calls. Safe to run again. */
  @UseCase()
  async revokeGrant(grantId: string): Promise<void> {
    const token = await this.repo.first({ grantId })
    if (!token) return
    token.revoke()
    await this.repo.persist(token)
  }

  /**
   * Removes the tokens whose refresh token expired: a client that stopped refreshing
   * never gives them back. What the nightly worker calls; the second time, there are none.
   */
  @UseCase()
  async purgeExpired(): Promise<number> {
    return this.repo.purgeExpired(now())
  }
}
