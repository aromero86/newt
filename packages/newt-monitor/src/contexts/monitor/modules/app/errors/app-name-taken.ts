import { ConflictError } from 'newt/core'

export class AppNameTaken extends ConflictError {
  readonly code = 'app.name_taken'
  constructor(name: string) {
    super(`There is an application named ${name} already`)
  }
}
