import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Token, type TokenEntityDTO } from './token'

export type TokenRow = TokenEntityDTO & { version: number }

export class Token_Repository extends TableRepository<Token, TokenRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<TokenRow>('token'))
  }

  protected toEntity(row: TokenRow): Token {
    return Token.fromDTO(row)
  }
}
