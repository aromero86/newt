import { NotFoundError } from '../../../core/errors/not-found-error'

export class NoteNotFound extends NotFoundError {
  readonly code = 'note.not_found'
  constructor(id: string) {
    super(`Note ${id} not found`)
  }
}
