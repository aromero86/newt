import type { z } from 'zod'
import { EntityError } from './entity-error'

/**
 * An entity whose data does not pass its schema: a bad row read from the store, or a
 * value a use case computed wrong. A programming error, not the client's: the
 * client's input is checked before, by the use case. It carries zod's issues as its
 * `cause`, for the log; a client gets a 500 that says nothing about the inside.
 */
export class InvalidEntity extends EntityError {
  constructor(entity: string, id: string, error: z.ZodError, field?: string) {
    const where = (path: PropertyKey[]) => [field, ...path].filter(each => each !== undefined).map(String).join('.') || '(root)'
    super(`${entity} ${id} does not pass its schema: ${error.issues.map(issue => `${where(issue.path)}: ${issue.message}`).join('; ')}`)
    this.cause = error
  }
}
