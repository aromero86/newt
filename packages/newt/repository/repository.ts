import type { Entity, EntitySchema } from '../core'
import { markPersisted, takeEvents } from '../core/internal'
import type { RepositoryBase } from './repository-base'
import type { SaveHooks } from './save-hooks'

/**
 * The only place that reads and writes a module's entities. It saves them however
 * its storage wants (`write`), and the framework does the rest: one transaction for
 * all of them, their hooks and the events they tell, and their versions once saved.
 *
 * `TableRepository` writes them for you on a `Table`; extend this one when they are
 * stored in a way a table cannot say (several tables, a projection, an outside API).
 */
export abstract class Repository<E extends Entity<EntitySchema>, B extends RepositoryBase = RepositoryBase> {

  constructor(protected readonly base: B) {}

  protected get store(): B['store'] {
    return this.base.store
  }

  /**
   * Saves entities of this module, and what they have to tell, at once: all of them
   * or none. `write` stores one, in the transaction; one with nothing to save is not
   * written, keeps its version, and tells nothing (a change undone is no change: an
   * event always comes with a change). Every stored one changed or deleted must still
   * be the version it was read as, and a new one must not collide with a key or
   * unique value: `ConcurrencyConflict` otherwise.
   *
   * `before` writes what must go first (the rows they replace); `after` writes what
   * follows from them, or checks a rule over several rows (a workspace keeps an
   * admin), which no version covers: `guard` names what that rule protects, so no
   * other save guarding it runs in between. Either hook throws to roll it all back.
   *
   * It is the only way a repository writes its entities: whatever it writes, it
   * writes here or in `saveRows`, never in a transaction of its own.
   */
  protected async save<T extends E>(entities: T[], write: (entity: T) => void | Promise<void>, hooks: SaveHooks = {}): Promise<void> {
    this.base.invocations?.checkWrite()
    const changed = entities.filter(entity => entity.hasPendingChanges)
    await this.store.transaction(async () => {
      if (hooks.guard?.length) await this.store.guard(hooks.guard)
      await hooks.before?.()
      for (const entity of changed) await write(entity)
      await hooks.after?.()
      for (const entity of entities) {
        const events = entity[takeEvents]()
        // One that ends as it was read has nothing to tell: a change undone is no change.
        if (!entity.hasPendingChanges) continue
        for (const event of events) await this.base.publisher.publish(event)
      }
      // Saved once it commits, which may be later: inside another transaction, when that one does.
      this.store.afterCommit(() => {
        for (const entity of changed) entity[markPersisted]()
      })
    })
  }

  /**
   * Writes rows that are no entity's (a projection, a search index, a link table
   * rewritten whole) as a save does: in one transaction, under the write rule, and
   * guarding what `guard` names.
   */
  protected async saveRows(write: () => void | Promise<void>, options: { guard?: string[] } = {}): Promise<void> {
    this.base.invocations?.checkWrite()
    await this.store.transaction(async () => {
      if (options.guard?.length) await this.store.guard(options.guard)
      await write()
    })
  }
}
