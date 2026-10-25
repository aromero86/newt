import { ConflictError } from 'newt/core'

export class NoteTitleTaken extends ConflictError {
  readonly code = 'note.title_taken'
  constructor(title: string) {
    super(`There is a note called ${title} already`)
  }
}
