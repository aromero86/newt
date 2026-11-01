import { NotFoundError } from 'newt-kit/core'

export class StructureVersionNotFound extends NotFoundError {
  readonly code = 'structure.version_not_found'
  constructor(id: string) {
    super(`There is no structure version ${id}`)
  }
}
