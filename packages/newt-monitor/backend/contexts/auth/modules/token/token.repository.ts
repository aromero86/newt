import { now } from 'newt/core'
import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Token, type TokenEntityDTO } from './token'

export type TokenRow = TokenEntityDTO & { version: number }

/** A refresh token a grant's token replaced, by its hash: brought again, it was copied. */
export type TokenSpentRefreshRow = { id: string, grantId: string, spentAt: string, version: number }

export class Token_Repository extends TableRepository<Token, TokenRow, AuthBase> {

  private readonly spent

  constructor(base: AuthBase) {
    // No scope: a token is a person's, found by its hash, in no tenant.
    super(base, base.store.table<TokenRow>('token'), { scope: 'none' })
    this.spent = base.store.table<TokenSpentRefreshRow>('token_spent_refresh')
  }

  protected toEntity(row: TokenRow): Token {
    return Token.fromDTO(row)
  }

  /** The grant whose token once had this refresh token, replaced since; undefined when none did. */
  async grantThatSpent(refreshTokenHash: string): Promise<string | undefined> {
    const [spent] = await this.spent.find({ id: refreshTokenHash })
    return spent?.grantId
  }

  /**
   * Stores a token, and in the same save every refresh token it replaced: one
   * rotated keeps the one it spent, one gone (given back, copied) takes its spent ones with it.
   */
  protected async write(token: Token): Promise<void> {
    const spent = token.refreshTokenSpent
    await super.write(token)
    if (token.isDeleted) await this.spent.deleteMany({ grantId: token.grantId })
    else if (spent) await this.spent.insert({ id: spent, grantId: token.grantId, spentAt: now().toISOString() })
  }
}
