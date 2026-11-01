import { ConflictError } from 'newt-kit/core'

export class BoardNameTaken extends ConflictError {
  readonly code = 'board.name_taken'
  constructor(name: string) {
    super(`There is a board called ${name} in this workspace already`)
  }
}
