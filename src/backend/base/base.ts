import type { EventBus } from '../core/events/event-bus'
import type { EventPublisher } from '../core/events/event-publisher'
import { deferEmit } from '../core/unit-of-work/defer-emit'
import { TransactionManager } from '../core/unit-of-work/transaction-manager'
import type { BaseConfig } from './base-config'
import { Database } from './database/database'
import { MigrationRunner } from './database/migration-runner'
import { InMemoryEventBus } from './events/in-memory-event-bus'
import { HttpRouter } from './http/http-router'

/**
 * The infrastructure every module receives: the database, the transactions, the
 * event bus and the HTTP router its routes go on. Opening it brings the database
 * up to date first.
 */
export class Base {

  readonly transactions: TransactionManager
  readonly bus: EventBus
  /** Publishes after the commit of the use case in progress, or at once outside one. */
  readonly publisher: EventPublisher
  readonly http = new HttpRouter()

  private constructor(readonly db: Database) {
    this.transactions = new TransactionManager(db)
    this.bus = new InMemoryEventBus()
    this.publisher = { publish: event => deferEmit(() => this.bus.publish(event)) }
  }

  static async open(config: BaseConfig): Promise<Base> {
    const db = await Database.open(config.dbPath)
    try {
      await new MigrationRunner(db.sqlite, config.migrationsFolder).up()
    } catch (error) {
      db.close()
      throw error
    }
    return new Base(db)
  }

  close(): void {
    this.db.close()
  }
}
