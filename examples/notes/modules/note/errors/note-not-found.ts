import { NotFoundError } from 'newt/core'

export class NoteNotFound extends NotFoundError {
  readonly code = 'note.not_found'
  constructor(id: string) {
    super(`There is no note ${id}`)
  }
}
