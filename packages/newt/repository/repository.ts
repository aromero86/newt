import { ConcurrencyConflict, type Entity, type EntitySchema } from '../core'
import { assertSavable, markPersisted, restoreSaved, savedState, takeEvents } from '../core/internal'
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
   * event always comes with a change). One that tells something but never changed is
   * a mistake, refused before anything is written (`EventWithoutChange`). Every stored
   * one changed or deleted must still be the version it was read as, and a new one
   * must not collide with a key or unique value: `ConcurrencyConflict` otherwise
   * (`DuplicateValue`, for a value taken). Each is marked saved once written (in
   * `after` it already is), and put back as it was if the transaction rolls back:
   * then it is never saved again (`SaveRolledBack`), and the use case reads it again,
   * as it does when it runs again on a conflict.
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
    for (const entity of entities) entity[assertSavable]()
    const changed = new Set(entities.filter(entity => entity.hasPendingChanges))
    await this.store.transaction(async () => {
      // Each is saved as it is written, so saving it again in the same transaction
      // writes what changed since; if the transaction rolls back, even one it joined
      // later, each is put back as it was, and refuses to be saved again.
      const saved = entities.map(entity => ({ entity, state: entity[savedState]() }))
      this.store.afterRollback(() => {
        for (const { entity, state } of saved) entity[restoreSaved](state)
      })
      if (hooks.guard?.length) await this.store.guard(hooks.guard)
      await hooks.before?.()
      for (const entity of changed) {
        await write(entity)
        entity[markPersisted]()
      }
      await hooks.after?.()
      for (const entity of entities) {
        const events = entity[takeEvents]()
        // One that ends as it was read has nothing to tell: a change undone is no change.
        if (!changed.has(entity)) continue
        for (const event of events) await this.base.publisher.publish(event)
      }
    })
  }

  /**
   * Makes the use case run again, from `after`: a row the save holds no version of
   * changed meanwhile (a card someone added to a column whose order it rewrites), so
   * what it decided may no longer hold. It is a `ConcurrencyConflict`, as a version
   * found stale is.
   */
  protected conflict(): never {
    throw new ConcurrencyConflict()
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
