import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Token, type TokenEntityDTO } from './token'

export type TokenRow = TokenEntityDTO & { version: number }

export class Token_Repository extends TableRepository<Token, TokenRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: a token is a person's, found by its hash, in no tenant.
    super(base, base.store.table<TokenRow>('token'), { scope: 'none' })
  }

  protected toEntity(row: TokenRow): Token {
    return Token.fromDTO(row)
  }

  /** Removes for good the tokens whose refresh token expired by `at`, with the hash it replaced: how many it removed. */
  purgeExpired(at: Date): Promise<number> {
    return this.purge({ refreshExpiresAt: { lte: at.toISOString() } })
  }
}
