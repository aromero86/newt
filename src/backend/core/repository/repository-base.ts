import type { EventPublisher } from '../events/event-publisher'

/** What a repository needs from the backend: the database handle and where to publish. */
export interface RepositoryBase {
  readonly db: { readonly drizzle: unknown }
  readonly publisher: EventPublisher
}
