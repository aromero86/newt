import type { DomainEvent } from '../events/domain-event'

/**
 * What only a repository does to an entity: read what it is as saved, and put it back
 * when the save that marked it saved rolls back. See `markPersisted`.
 */
export const savedState = Symbol('savedState')
export const restoreSaved = Symbol('restoreSaved')

/** What an entity is as saved (`initial`: its fields as stored), with what it has to tell. */
export type SavedState = {
  readonly version: number
  readonly isNew: boolean
  readonly initial: unknown
  readonly events: readonly DomainEvent[]
}
