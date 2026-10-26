import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ConcurrencyConflict, Entity, matches, type Criteria, type DomainEvent, type EntityInput, type Invocations } from '../core'
import { TransactionScope, type FindOptions, type NewRow, type Store, type Table } from '../port-store'
import type { RepositoryBase } from './repository-base'
import type { SaveHooks } from './save-hooks'
import { TableRepository } from './table-repository'
import { takeEvents } from '../core/internal'
import { SaveRolledBack } from '../core/entity/errors/save-rolled-back'
import type { TableRepositoryOptions } from './table-repository-options'

const ThingSchema = z.object({ id: z.string(), name: z.string(), createdAt: z.string().default(''), updatedAt: z.string().default('') })
type ThingDTO = z.infer<typeof ThingSchema>
type ThingRow = ThingDTO & { version: number, deletedAt?: string | null }

class Thing extends Entity<typeof ThingSchema> {
  static create(name: string) {
    const thing = new Thing(ThingSchema, { name } as EntityInput<ThingDTO>, true)
    thing.trackEvent({ name: 'thing.created', payload: name, occurredAt: '' })
    return thing
  }

  static fromRow(row: ThingRow) {
    return new Thing(ThingSchema, row, false)
  }

  rename(name: string) {
    this.change({ name })
    this.trackEvent({ name: 'thing.renamed', payload: name, occurredAt: '' })
  }

  remove() {
    this.markAsDeleted()
  }

  /** Tells something without changing anything: a mistake. */
  ping() {
    this.trackEvent({ name: 'thing.pinged', payload: null, occurredAt: '' })
  }
}

/** One log for the whole save, so a test reads it as it happened. */
function world(options: TableRepositoryOptions<ThingRow> = {}, rows: ThingRow[] = []) {
  const log: string[] = []
  const scope = new TransactionScope()
  let failNextWrite = false

  const table: Table<ThingRow> = {
    async find(criteria?: Criteria<ThingRow>, findOptions?: FindOptions<ThingRow>) {
      log.push(`find ${JSON.stringify(criteria)} ${JSON.stringify(findOptions ?? {})}`)
      return rows.filter(row => matches(row, criteria)).slice(0, findOptions?.limit)
    },
    async count(criteria?: Criteria<ThingRow>) {
      log.push(`count ${JSON.stringify(criteria)}`)
      return rows.filter(row => matches(row, criteria)).length
    },
    async insert(row: NewRow<ThingRow>) {
      log.push(`insert ${JSON.stringify(row)}`)
    },
    async update(id: string, version: number, changes: Partial<NewRow<ThingRow>>) {
      if (failNextWrite) throw new ConcurrencyConflict()
      log.push(`update ${id}@${version} ${JSON.stringify(Object.keys(changes).sort())}`)
    },
    async patch() {},
    async delete(id: string, version: number) {
      log.push(`delete ${id}@${version}`)
    },
  }

  const store: Store = {
    transaction: fn => scope.run(fn, undefined, {
      begin: () => void log.push('begin'),
      commit: () => void log.push('commit'),
      rollback: () => void log.push('rollback'),
    }),
    guard: async keys => void log.push(`guard ${keys.join(',')}`),
    afterCommit: fn => scope.afterCommit(fn),
    afterRollback: fn => scope.afterRollback(fn),
    table: () => table as never,
    outbox: {} as never,
    migrations: {} as never,
    close: async () => {},
  }

  let refuseWrites = false
  const base: RepositoryBase = {
    store,
    publisher: { publish: (event: DomainEvent) => void log.push(`publish ${event.name}`) },
    invocations: {
      checkWrite: () => {
        log.push('checkWrite')
        if (refuseWrites) throw new Error('write rule')
      },
    } as unknown as Invocations,
  }

  class Things extends TableRepository<Thing, ThingRow> {
    protected toEntity(row: ThingRow) {
      return Thing.fromRow(row)
    }

    saveWith(entities: Thing[], hooks: SaveHooks) {
      return this.save(entities, entity => this.write(entity), hooks)
    }

    everywhere(criteria: Criteria<ThingRow> = {}) {
      return this.findInEveryScope(criteria)
    }

    stamp(guard?: string[]) {
      return this.saveRows(() => this.table.insert({ id: 'stamp', name: 'stamped' } as never), { guard })
    }
  }

  return {
    log,
    store,
    repo: new Things(base, table, options),
    failNextWrite: () => { failNextWrite = true },
    refuseWrites: () => { refuseWrites = true },
  }
}

const stored = (over: Partial<ThingRow> = {}): ThingRow => ({ id: 't1', name: 'one', createdAt: 'c', updatedAt: 'u', version: 2, ...over })

describe('persist', () => {
  test('inserts a new one, tells its events in the transaction, and marks it saved once it commits', async () => {
    const { log, repo } = world()
    const thing = Thing.create('one')

    await repo.persist(thing)

    expect(log).toEqual(['checkWrite', 'begin', `insert ${JSON.stringify(thing.toDTO())}`, 'publish thing.created', 'commit'])
    expect(thing.isNew).toBe(false)
    expect(thing.version).toBe(1)
  })

  test('changes a stored one at the version it was read, writing only what changed', async () => {
    const { log, repo } = world()
    const thing = Thing.fromRow(stored())
    thing.rename('two')

    await repo.persist(thing)

    expect(log).toEqual(['checkWrite', 'begin', 'update t1@2 ["name","updatedAt"]', 'publish thing.renamed', 'commit'])
    expect(thing.version).toBe(3)
  })

  test('writes nothing for one with nothing to save, and leaves its version', async () => {
    const { log, repo } = world()
    const unchanged = Thing.fromRow(stored())

    await repo.persist(unchanged)

    expect(log).toEqual(['checkWrite', 'begin', 'commit'])
    expect(unchanged.version).toBe(2)
  })

  test('a change undone is no change: it writes nothing and tells nothing', async () => {
    const { log, repo } = world()
    const thing = Thing.fromRow(stored())

    thing.rename('two')
    thing.rename('one')
    await repo.persist(thing)

    expect(log).toEqual(['checkWrite', 'begin', 'commit'])
    expect(thing[takeEvents]()).toEqual([])
  })

  test('one that tells something but never changed is refused, and nothing of the save is written', async () => {
    const { log, repo } = world()
    const thing = Thing.fromRow(stored())
    thing.ping()

    await expect(repo.persist(Thing.create('two'), thing)).rejects.toThrow('Thing t1 tells thing.pinged but has nothing to save: change what it tells of')

    expect(log).toEqual(['checkWrite'])
  })

  test('deletes a deleted one at its version, or stamps it when deleting softly', async () => {
    const hard = world()
    const gone = Thing.fromRow(stored())
    gone.remove()
    await hard.repo.persist(gone)

    const soft = world({ softDelete: true })
    const stamped = Thing.fromRow(stored({ deletedAt: null }))
    stamped.remove()
    await soft.repo.persist(stamped)

    expect(hard.log).toContain('delete t1@2')
    expect(soft.log).toContain('update t1@2 ["deletedAt","updatedAt"]')
  })

  test('a new row deleted softly is stored with deletedAt null', async () => {
    const { log, repo } = world({ softDelete: true })

    await repo.persist(Thing.create('one'))

    expect(log[2]).toContain('"deletedAt":null')
  })

  test('a conflict rolls it all back: nothing told, nothing marked saved', async () => {
    const { log, repo, failNextWrite } = world()
    const thing = Thing.fromRow(stored())
    thing.rename('two')
    failNextWrite()

    await expect(repo.persist(thing)).rejects.toThrow(ConcurrencyConflict)

    expect(log).toEqual(['checkWrite', 'begin', 'rollback'])
    expect(thing.version).toBe(2)
    expect(thing.hasPendingChanges).toBe(true)
  })

  test('inside a transaction that rolls back later, it is not marked saved', async () => {
    const { repo, store } = world()
    const thing = Thing.fromRow(stored())
    thing.rename('two')

    await store.transaction(async () => {
      await repo.persist(thing)
      throw new Error('later step failed')
    }).catch(() => {})

    expect(thing.version).toBe(2)
    expect(thing.hasPendingChanges).toBe(true)
  })

  test('inside a transaction that rolls back later, a deletion is left unsaved, and a new one new again', async () => {
    const { repo, store } = world()
    const deleted = Thing.fromRow(stored())
    deleted.remove()
    const created = Thing.create('one')

    await store.transaction(async () => {
      await repo.persist(deleted, created)
      throw new Error('later step failed')
    }).catch(() => {})

    expect([deleted.version, deleted.hasPendingChanges]).toEqual([2, true])
    expect([created.isNew, created.version]).toEqual([true, 0])
  })

  test('one whose save rolled back is never saved again: a change since would tell less than it writes', async () => {
    const { log, repo, store } = world()
    const thing = Thing.fromRow(stored())
    thing.rename('two')

    await store.transaction(async () => {
      await repo.persist(thing)
      thing.rename('three')
      throw new Error('later step failed')
    }).catch(() => {})
    log.length = 0

    await expect(repo.persist(thing)).rejects.toThrow(SaveRolledBack)
    await expect(repo.persist(thing)).rejects.toThrow('Thing t1 was in a save that rolled back: read it again, and save that one')
    expect(log).toEqual(['checkWrite', 'checkWrite'])
  })

  test('so is one whose own save failed', async () => {
    const { repo, failNextWrite } = world()
    const thing = Thing.fromRow(stored())
    thing.rename('two')
    failNextWrite()

    await expect(repo.persist(thing)).rejects.toThrow(ConcurrencyConflict)

    await expect(repo.persist(thing)).rejects.toThrow(SaveRolledBack)
  })

  test('saved twice in one transaction, the second writes what changed since, one version on', async () => {
    const { log, repo, store } = world()
    const thing = Thing.create('one')

    await store.transaction(async () => {
      await repo.persist(thing)
      thing.rename('two')
      await repo.persist(thing)
    })

    expect(log.map(line => line.split(' ')[0])).toEqual(['begin', 'checkWrite', 'insert', 'publish', 'checkWrite', 'update', 'publish', 'commit'])
    expect(log).toContain(`update ${thing.id}@1 ["name","updatedAt"]`)
    expect(log).toContain('publish thing.renamed')
    expect(thing.version).toBe(2)
  })

  test('a change after the save, in the same transaction, is still to save once it commits', async () => {
    const { repo, store } = world()
    const thing = Thing.create('one')

    await store.transaction(async () => {
      await repo.persist(thing)
      thing.rename('two')
    })

    expect(thing.version).toBe(1)
    expect(thing.getChanges()).toEqual({ name: 'two' })
    expect(thing[takeEvents]().map(event => event.name)).toEqual(['thing.renamed'])
  })

  test('a conflict puts back the ones it already wrote', async () => {
    const { repo, failNextWrite } = world()
    const fresh = Thing.create('one')
    const stale = Thing.fromRow(stored())
    stale.rename('two')
    failNextWrite()

    await expect(repo.persist(fresh, stale)).rejects.toThrow(ConcurrencyConflict)

    expect([fresh.isNew, fresh.version, fresh.hasPendingChanges]).toEqual([true, 0, true])
    expect(fresh[takeEvents]().map(event => event.name)).toEqual(['thing.created'])
  })

  test('the write rule is asked first, and a refusal writes nothing', async () => {
    const { log, repo, refuseWrites } = world()
    refuseWrites()

    await expect(repo.persist(Thing.create('one'))).rejects.toThrow('write rule')

    expect(log).toEqual(['checkWrite'])
  })
})

describe('save with hooks', () => {
  test('guards, writes what goes first, the entities, what follows, then tells', async () => {
    const { log, repo } = world()

    await repo.saveWith([Thing.create('one')], {
      guard: ['stock:p1', 'stock:p2'],
      before: () => void log.push('before'),
      after: () => void log.push('after'),
    })

    expect(log.map(line => line.split(' ')[0])).toEqual(['checkWrite', 'begin', 'guard', 'before', 'insert', 'after', 'publish', 'commit'])
    expect(log[2]).toBe('guard stock:p1,stock:p2')
  })

  test('guards nothing when it names nothing', async () => {
    const { log, repo } = world()

    await repo.saveWith([Thing.create('one')], { guard: [] })

    expect(log.some(line => line.startsWith('guard'))).toBe(false)
  })

  test('an after names what it guards, even if it is nothing', () => {
    // @ts-expect-error: an after without a guard
    const unguarded: SaveHooks = { after: () => {} }
    const none: SaveHooks = { guard: [], after: () => {} }
    const plain: SaveHooks = { before: () => {} }

    expect([unguarded, none, plain]).toHaveLength(3)
  })
})

describe('saveRows', () => {
  test('writes rows as a save does: under the write rule, in a transaction, guarding what it names', async () => {
    const { log, repo } = world()

    await repo.stamp(['index:t1'])

    expect(log.map(line => line.split(' ')[0])).toEqual(['checkWrite', 'begin', 'guard', 'insert', 'commit'])
    expect(log[2]).toBe('guard index:t1')
  })

  test('guards nothing when it names nothing', async () => {
    const { log, repo } = world()

    await repo.stamp()

    expect(log.some(line => line.startsWith('guard'))).toBe(false)
  })
})

describe('a scope', () => {
  // The scope here is the name: what the unit needs is a string field of the row.
  const scoped = { softDelete: true, scope: { field: 'name' as const, current: () => 'one' } }

  test('is part of every query, beside the deleted ones left out, whatever the criteria say', async () => {
    const { log, repo } = world(scoped)

    await repo.find({ name: 'two' })

    expect(log[0]).toBe('find {"and":[{"and":[{"name":"two"},{"name":"one"}]},{"deletedAt":null}]} {}')
  })

  test('is left out by findInEveryScope, which still leaves the deleted ones out', async () => {
    const { log, repo } = world(scoped)

    await repo.everywhere()

    expect(log[0]).toBe('find {"and":[{},{"deletedAt":null}]} {}')
  })

  test('refuses to delete an entity of another one', async () => {
    const { log, repo } = world(scoped)
    const thing = Thing.fromRow(stored({ name: 'two' }))
    thing.remove()

    await expect(repo.persist(thing)).rejects.toThrow('not to the current one')
    expect(log).toContain('rollback')
    expect(log.some(line => line.startsWith('update') || line.startsWith('delete'))).toBe(false)
  })
  test('refuses to save one stored in another, though moved to it', async () => {
    const { log, repo } = world(scoped)
    const moved = Thing.fromRow(stored({ name: 'two' }))
    moved.rename('one')
    const deleted = Thing.fromRow(stored({ name: 'two' }))
    deleted.rename('one')
    deleted.remove()

    await expect(repo.persist(moved)).rejects.toThrow("belongs to name 'two'")
    await expect(repo.persist(deleted)).rejects.toThrow("belongs to name 'two'")
    expect(log.some(line => line.startsWith('update') || line.startsWith('delete'))).toBe(false)
  })
})

describe('finding', () => {
  test('leaves out the ones deleted softly', async () => {
    const { log, repo } = world({ softDelete: true }, [stored(), stored({ id: 't2', deletedAt: 'gone' })])

    expect((await repo.find()).map(thing => thing.id)).toEqual(['t1'])
    expect(await repo.count()).toBe(1)
    expect(log[0]).toContain('"deletedAt":null')
  })

  test('first asks for one', async () => {
    const { log, repo } = world({}, [stored(), stored({ id: 't2' })])

    expect((await repo.first())?.id).toBe('t1')
    expect(log[0]).toContain('{"limit":1}')
  })

  test('a page reads one more than its size after the cursor, and counts them all', async () => {
    const rows = ['t1', 't2', 't3', 't4'].map(id => stored({ id }))
    const { log, repo } = world({}, rows)

    const page = await repo.page({}, { size: 2, cursor: 't1' })

    expect(page.items.map(thing => thing.id)).toEqual(['t2', 't3'])
    expect(page.hasMore).toBe(true)
    expect(page.total).toBe(4)
    expect(log).toContain('find {"and":[{},{"id":{"gt":"t1"}}]} {"limit":3}')
    expect(log).toContain('count {}')
  })

  test('newest first, it reads back from the cursor, by id from the newest', async () => {
    const rows = ['t1', 't2', 't3', 't4'].map(id => stored({ id }))
    const { log, repo } = world({}, rows)

    await repo.page({}, { size: 2, cursor: 't4' }, { newestFirst: true })

    expect(log).toContain('find {"and":[{},{"id":{"lt":"t4"}}]} {"limit":3,"orderBy":[{"field":"id","direction":"desc"}]}')
    expect(log).toContain('count {}')
  })
})
