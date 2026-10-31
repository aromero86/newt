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

  /** Removes for good the tokens whose refresh token expired by `at`, with every refresh token they replaced: how many it removed. */
  async purgeExpired(at: Date): Promise<number> {
    // Read before the save, which reads nothing: a token past its refresh is never rotated again.
    const expired = { refreshExpiresAt: { lte: at.toISOString() } }
    const grantIds = (await this.table.find(expired)).map(row => row.grantId)
    if (grantIds.length === 0) return 0
    let removed = 0
    await this.saveRows(async () => {
      removed = await this.table.deleteMany(expired)
      await this.spent.deleteMany({ grantId: { in: grantIds } })
    })
    return removed
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
