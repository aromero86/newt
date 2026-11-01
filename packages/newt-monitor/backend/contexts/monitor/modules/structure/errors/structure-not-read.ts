import { NotFoundError } from 'newt-kit/core'

/** An application whose structure the monitor has not read yet: it never answered a refresh. */
export class StructureNotRead extends NotFoundError {
  readonly code = 'structure.not_read'
  constructor(appId: string) {
    super(`The structure of application ${appId} has not been read yet`)
  }
}
