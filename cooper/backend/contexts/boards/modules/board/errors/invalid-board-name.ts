import { ValidationError } from 'newt/core'

export class InvalidBoardName extends ValidationError {
  readonly code = 'board.invalid_name'
  constructor(value: string) {
    super(`'${value}' is not a board's name: it has 1 to 60 characters`)
  }
}
