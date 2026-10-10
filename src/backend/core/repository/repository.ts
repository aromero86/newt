import type { EventPublisher } from '../events/event-publisher'
import type { RepositoryBase } from './repository-base'

/** The only place that touches the database. A module has one, for its own tables. */
export abstract class Repository<TBase extends RepositoryBase> {

  constructor(protected readonly base: TBase) {}

  protected get db(): TBase['db']['drizzle'] {
    return this.base.db.drizzle
  }

  protected get publisher(): EventPublisher {
    return this.base.publisher
  }
}
