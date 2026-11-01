import { NotFoundError } from 'newt-kit/core'

export class CardNotFound extends NotFoundError {
  readonly code = 'card.not_found'
  constructor(id: string) {
    super(`There is no card ${id}`)
  }
}
