import { ConflictError } from 'newt-kit/core'

/** Only an archived application is deleted: archiving first is the step back nobody takes by mistake. */
export class AppNotArchived extends ConflictError {
  readonly code = 'app.not_archived'
  constructor(name: string) {
    super(`${name} is not archived: archive it before deleting it`)
  }
}
