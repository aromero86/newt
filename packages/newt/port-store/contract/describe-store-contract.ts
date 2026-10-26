import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ConcurrencyConflict, DuplicateValue, Entity, type DomainEvent, type EntityInput } from '../../core'
import { Base } from '../../runtime'
import { JobQueue } from '../../runtime/internal'
import { TableRepository } from '../../repository'
import type { Store, Table, TableOptions } from '../../port-store'
import type { StoreFixture } from './store-fixture'
import type { ThingRow } from './thing-row'

/**
 * Checks an adapter keeps every promise `Store` makes: transactions, isolation,
 * versions, criteria, the outbox, and what the framework builds on them (repositories,
 * the job queue). An adapter's test calls it once:
 *
 * ```ts
 * describeStoreContract('my store', { open: () => MyStore.open(…) })
 * ```
 */
export function describeStoreContract<S extends Store>(name: string, fixture: StoreFixture<S>): void {
  describe(`${name} keeps the Store contract`, () => {
    let store: S
    let things: Table<ThingRow>
    const queues: JobQueue[] = []

    beforeEach(async () => {
      store = await fixture.open()
      things = store.table<ThingRow>('thing', THING)
    })

    afterEach(async () => {
      await Promise.all(queues.splice(0).map(queue => queue.stop()))
      await store.close()
    })

    const thing = (over: Partial<ThingRow> = {}): Omit<ThingRow, 'version'> => {
      const now = new Date().toISOString()
      return { id: Bun.randomUUIDv7(), workspaceId: 'w1', name: `thing ${Bun.randomUUIDv7()}`, archived: false, rank: 0, note: null, tags: [], createdAt: now, updatedAt: now, deletedAt: null, ...over }
    }
    const names = async () => (await things.find()).map(row => row.name).sort()

    describe('a transaction', () => {
      test('commits all it writes', async () => {
        await store.transaction(async () => {
          await things.insert(thing({ name: 'ana' }))
          await things.insert(thing({ name: 'bea' }))
        })

        expect(await names()).toEqual(['ana', 'bea'])
      })

      test('rolls all of it back when it throws', async () => {
        await expect(store.transaction(async () => {
          await things.insert(thing({ name: 'ana' }))
          throw new Error('boom')
        })).rejects.toThrow('boom')

        expect(await names()).toEqual([])
      })

      test('inside another is part of it', async () => {
        await expect(store.transaction(async () => {
          await store.transaction(() => things.insert(thing({ name: 'ana' })))
          throw new Error('boom')
        })).rejects.toThrow('boom')

        expect(await names()).toEqual([])
      })

      test('reads what it wrote before it commits', async () => {
        await store.transaction(async () => {
          await things.insert(thing({ name: 'ana' }))
          expect(await names()).toEqual(['ana'])
        })
      })

      test('a write outside one runs in one of its own', async () => {
        await things.insert(thing({ name: 'ana' }))

        expect(await names()).toEqual(['ana'])
      })

      test('runs writes side by side in it, each on its own: a collision fails alone', async () => {
        await things.insert(thing({ name: 'taken' }))

        const outcomes = await store.transaction(() => Promise.allSettled([
          things.insert(thing({ name: 'ana' })),
          things.insert(thing({ name: 'taken' })),
          things.insert(thing({ name: 'bea' })),
        ]))

        expect(outcomes.map(outcome => outcome.status === 'fulfilled' ? 'ok' : outcome.reason instanceof DuplicateValue ? 'duplicate' : String(outcome.reason))).toEqual(['ok', 'duplicate', 'ok'])
        expect(await names()).toEqual(['ana', 'bea', 'taken'])
      })

      test('rolled back while writes of it are still in flight, keeps none of them: they fail', async () => {
        let late!: Promise<string>
        await expect(store.transaction(async () => {
          const writes = (async () => {
            await things.insert(thing({ name: 'ana' }))
            await things.insert(thing({ name: 'bea' }))
          })()
          late = writes.then(() => 'written', (error: Error) => error.message)
          await Promise.all([writes, Promise.reject(new Error('boom'))])
        })).rejects.toThrow('boom')

        expect(await late).toContain('a transaction that has ended')
        await Bun.sleep(20)
        expect(await names()).toEqual([])
      })

      test('a write of it that comes after it committed fails, and runs nowhere', async () => {
        let late!: Promise<string>
        await store.transaction(async () => {
          await things.insert(thing({ name: 'ana' }))
          // Left unawaited: it comes once the transaction has ended.
          late = Bun.sleep(5).then(() => things.insert(thing({ name: 'late' }))).then(() => 'written', (error: Error) => error.message)
        })

        expect(await late).toContain('a transaction that has ended')
        expect(await names()).toEqual(['ana'])
      })

      test('a read of it that comes after it committed fails, and runs nowhere', async () => {
        let late!: Promise<string>
        await store.transaction(async () => {
          await things.insert(thing({ name: 'ana' }))
          late = Bun.sleep(5).then(() => things.find()).then(() => 'read', (error: Error) => error.message)
        })

        expect(await late).toContain('a transaction that has ended')
      })
    })

    describe('isolation', () => {
      test('a read outside a transaction never sees what it has not committed', async () => {
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        let committed = false
        const writing = store.transaction(async () => {
          await things.insert(thing({ name: 'ana' }))
          store.afterCommit(() => { committed = true })
          await gate
        })
        await Bun.sleep(5)
        const reading = things.find().then(rows => ({ rows, committed }))
        await Bun.sleep(5)
        release()
        await writing

        const read = await reading
        expect(read.rows.length === 0 || read.committed).toBe(true)
        expect(await names()).toEqual(['ana'])
      })

      test('transactions that guard the same key never interleave: a rule over several rows holds', async () => {
        const addIfNone = (name: string) => store.transaction(async () => {
          await store.guard(['things:w1'])
          const before = await things.count({ workspaceId: 'w1' })
          await Bun.sleep(5)
          if (before === 0) await things.insert(thing({ name }))
        })

        const settled = await Promise.allSettled([addIfNone('ana'), addIfNone('bea')])

        // A store with concurrent transactions may refuse one instead: as a conflict, never as anything else.
        for (const each of settled) if (each.status === 'rejected') expect(each.reason).toBeInstanceOf(ConcurrencyConflict)
        expect(await things.count({ workspaceId: 'w1' })).toBe(1)
      })

      test('a guard taken after a read in the same transaction still holds the rule: the read fixes no snapshot', async () => {
        const addIfNone = (name: string) => store.transaction(async () => {
          await things.count({ workspaceId: 'other' })
          await Bun.sleep(5)
          await store.guard(['things:w1'])
          const before = await things.count({ workspaceId: 'w1' })
          await Bun.sleep(5)
          if (before === 0) await things.insert(thing({ name }))
        })

        const settled = await Promise.allSettled([addIfNone('ana'), addIfNone('bea')])

        for (const each of settled) if (each.status === 'rejected') expect(each.reason).toBeInstanceOf(ConcurrencyConflict)
        expect(await things.count({ workspaceId: 'w1' })).toBe(1)
      })
    })

    describe('guard', () => {
      test('is taken inside a transaction only', async () => {
        await expect(store.guard(['k'])).rejects.toThrow()
        await store.transaction(() => store.guard(['k', 'other']))
      })

      test('a save names what its rule guards, and its rule holds', async () => {
        const base = new Base({ name: 'test', store })
        class Things extends TableRepository<Thing, ThingRow> {
          protected toEntity(row: ThingRow): Thing {
            return Thing.fromRow(row)
          }
          /** Only one thing per workspace: a rule no version covers. */
          persistAlone(thing: Thing): Promise<void> {
            return this.save([thing], each => this.write(each), {
              guard: ['things:w1'],
              after: async () => {
                await Bun.sleep(5)
                if (await this.count({ workspaceId: 'w1' }) > 1) throw new Error('one per workspace')
              },
            })
          }
        }
        const repo = new Things(base, things)

        const settled = await Promise.allSettled([repo.persistAlone(Thing.create('ana')), repo.persistAlone(Thing.create('bea'))])

        expect(settled.filter(each => each.status === 'fulfilled')).toHaveLength(1)
        expect(await things.count({ workspaceId: 'w1' })).toBe(1)
      })
    })

    describe('afterCommit', () => {
      test('runs once the outermost transaction commits', async () => {
        const log: string[] = []
        await store.transaction(async () => {
          await store.transaction(() => store.afterCommit(() => log.push('after')))
          await things.insert(thing({ name: 'ana' }))
          log.push('writing')
        })

        expect(log).toEqual(['writing', 'after'])
      })

      test('never runs when it rolls back', async () => {
        const log: string[] = []
        await expect(store.transaction(() => {
          store.afterCommit(() => log.push('after'))
          throw new Error('boom')
        })).rejects.toThrow('boom')

        expect(log).toEqual([])
      })

      test('one that throws spoils neither the commit nor the others', async () => {
        const log: string[] = []
        const original = console.error
        console.error = () => {}
        try {
          await store.transaction(async () => {
            store.afterCommit(() => { throw new Error('boom') })
            store.afterCommit(() => log.push('second'))
            await things.insert(thing({ name: 'ana' }))
          })
        } finally {
          console.error = original
        }

        expect(log).toEqual(['second'])
        expect(await names()).toEqual(['ana'])
      })

      test('outside a transaction runs at once', () => {
        const log: string[] = []
        store.afterCommit(() => log.push('after'))

        expect(log).toEqual(['after'])
      })
    })

    describe('afterRollback', () => {
      test('runs once the outermost transaction rolls back, latest first, and never on a commit', async () => {
        const log: string[] = []
        await store.transaction(() => store.afterRollback(() => log.push('committed')))
        await expect(store.transaction(async () => {
          store.afterRollback(() => log.push('first'))
          await store.transaction(() => store.afterRollback(() => log.push('second')))
          await things.insert(thing({ name: 'ana' }))
          throw new Error('boom')
        })).rejects.toThrow('boom')

        expect(log).toEqual(['second', 'first'])
      })
    })

    describe('a table', () => {
      test('keeps every kind of field as it was given', async () => {
        const row = thing({ name: 'ana', archived: true, rank: 2.5, note: 'hi', tags: ['a', 'b'] })
        await things.insert(row)

        expect(await things.find()).toEqual([{ ...row, version: 1 }])
      })

      test('stores a new row as version 1, and each change moves it one on', async () => {
        const row = thing()
        await things.insert(row)
        await things.update(row.id, 1, { name: 'renamed' })

        expect(await things.find()).toEqual([{ ...row, name: 'renamed', version: 2 }])
      })

      test('refuses a change to a version no longer stored', async () => {
        const row = thing({ name: 'ana' })
        await things.insert(row)
        await things.update(row.id, 1, { name: 'theirs' })

        await expect(things.update(row.id, 1, { name: 'mine' })).rejects.toBeInstanceOf(ConcurrencyConflict)
        await expect(things.delete(row.id, 1)).rejects.toBeInstanceOf(ConcurrencyConflict)
        expect(await names()).toEqual(['theirs'])
      })

      test('refuses a row whose id or unique value is taken: a DuplicateValue, which names it if it can tell', async () => {
        const row = thing({ name: 'ana' })
        await things.insert(row)
        const other = thing({ name: 'bea' })
        await things.insert(other)
        const refusal = (write: Promise<void>) => write.then(() => { throw new Error('written') }, (error: unknown) => error)

        const id = await refusal(things.insert({ ...thing(), id: row.id }))
        const name = await refusal(things.insert(thing({ name: 'ana' })))
        const renamed = await refusal(things.update(other.id, 1, { name: 'ana' }))

        for (const error of [id, name, renamed]) expect(error).toBeInstanceOf(DuplicateValue)
        expect([[], ['id']]).toContainEqual((id as DuplicateValue).fields)
        for (const error of [name, renamed]) expect([[], ['name']]).toContainEqual((error as DuplicateValue).fields)
        expect((name as DuplicateValue).code).toBe('duplicate_value')
      })

      test('frees a unique value once its row is deleted softly', async () => {
        const row = thing({ name: 'ana' })
        await things.insert(row)
        await things.update(row.id, 1, { deletedAt: new Date().toISOString() })

        await things.insert(thing({ name: 'ana' }))
        expect(await things.count({ name: 'ana' })).toBe(2)
      })

      test('reports a collision inside a transaction in progress there and then', async () => {
        await things.insert(thing({ name: 'ana' }))

        await store.transaction(async () => {
          await expect(things.insert(thing({ name: 'ana' }))).rejects.toBeInstanceOf(DuplicateValue)
          await things.insert(thing({ name: 'bea' }))
        })
        expect(await names()).toEqual(['ana', 'bea'])
      })

      test('patches a row whatever its version, and leaves the version as it is', async () => {
        const row = thing({ note: null })
        await things.insert(row)
        await things.patch(row.id, { note: 'seen' })
        await things.patch('nobody', { note: 'seen' })

        expect(await things.find()).toEqual([{ ...row, note: 'seen', version: 1 }])
      })

      test('deletes a row still at its version', async () => {
        const row = thing()
        await things.insert(row)
        await things.delete(row.id, 1)

        expect(await things.find()).toEqual([])
        await expect(things.delete(row.id, 1)).rejects.toBeInstanceOf(ConcurrencyConflict)
      })

      test('deletes the rows that meet the criteria, whatever their version, and tells how many', async () => {
        await things.insert(thing({ name: 'ana', workspaceId: 'w1' }))
        const bea = thing({ name: 'bea', workspaceId: 'w1' })
        await things.insert(bea)
        await things.update(bea.id, 1, { deletedAt: new Date().toISOString() })
        await things.insert(thing({ name: 'cris', workspaceId: 'w2' }))

        expect(await things.deleteMany({ workspaceId: 'w1' })).toBe(2)
        expect(await names()).toEqual(['cris'])
        expect(await things.deleteMany({ workspaceId: 'w1' })).toBe(0)
        expect(await things.deleteMany({})).toBe(1)
        expect(await names()).toEqual([])
      })

      test('deletes many in the transaction in progress: undone with it', async () => {
        await things.insert(thing({ name: 'ana' }))

        await expect(store.transaction(async () => {
          expect(await things.deleteMany({ name: 'ana' })).toBe(1)
          expect(await names()).toEqual([])
          throw new Error('boom')
        })).rejects.toThrow('boom')
        expect(await names()).toEqual(['ana'])
      })

      test('finds by every operator', async () => {
        await things.insert(thing({ id: '01', name: 'Ana', rank: 1, archived: false, note: null }))
        await things.insert(thing({ id: '02', name: 'bea', rank: 2, archived: true, note: 'x' }))
        await things.insert(thing({ id: '03', name: 'cris', rank: 3, archived: false, note: 'y', workspaceId: 'w2' }))
        const ids = async (criteria: Parameters<typeof things.find>[0]) => (await things.find(criteria)).map(row => row.id)

        expect(await ids({})).toEqual(['01', '02', '03'])
        expect(await ids({ workspaceId: 'w1' })).toEqual(['01', '02'])
        expect(await ids({ archived: false })).toEqual(['01', '03'])
        expect(await ids({ note: null })).toEqual(['01'])
        expect(await ids({ note: { ne: null } })).toEqual(['02', '03'])
        expect(await ids({ note: { ne: 'x' } })).toEqual(['01', '03'])
        expect(await ids({ id: { in: ['03', '01'] } })).toEqual(['01', '03'])
        expect(await ids({ id: { in: [] } })).toEqual([])
        expect(await ids({ rank: { gt: 1 } })).toEqual(['02', '03'])
        expect(await ids({ rank: { gte: 2, lt: 3 } })).toEqual(['02'])
        expect(await ids({ rank: { lte: 1 } })).toEqual(['01'])
        expect(await ids({ name: { ieq: 'ANA' } })).toEqual(['01'])
        expect(await ids({ name: 'Ana', id: { ne: '01' } })).toEqual([])
        expect(await ids({ workspaceId: undefined, archived: undefined })).toEqual(['01', '02', '03'])
      })

      test('answers what SQL would where criteria meet null, and ignores an operator left undefined', async () => {
        await things.insert(thing({ id: '01', name: 'Ñandú', note: null, rank: 1 }))
        await things.insert(thing({ id: '02', name: 'acme', note: 'n', rank: 2 }))
        const ids = async (criteria: Parameters<typeof things.find>[0]) => (await things.find(criteria)).map(row => row.id)

        expect(await ids({ note: { in: [null, 'n'] } })).toEqual(['01', '02'])
        expect(await ids({ note: { in: [null] } })).toEqual(['01'])
        expect(await ids({ rank: { gt: null as unknown as number } })).toEqual([])
        expect(await ids({ note: { eq: undefined }, rank: { gt: undefined } })).toEqual(['01', '02'])
        expect(await ids({ name: { ieq: 'ACME' } })).toEqual(['02'])
        // As SQL's lower(): only A to Z change case.
        expect(await ids({ name: { ieq: 'ñandú' } })).toEqual([])
        await expect(things.find({}, { limit: Number.NaN })).rejects.toThrow('limit')
      })

      test('finds by groups of criteria, nested: every one (and), at least one (or)', async () => {
        await things.insert(thing({ id: '01', name: 'Ana', rank: 1, archived: false }))
        await things.insert(thing({ id: '02', name: 'bea', rank: 2, archived: true }))
        await things.insert(thing({ id: '03', name: 'cris', rank: 3, archived: false, workspaceId: 'w2' }))
        const ids = async (criteria: Parameters<typeof things.find>[0]) => (await things.find(criteria)).map(row => row.id)

        expect(await ids({ or: [{ rank: 1 }, { rank: 3 }] })).toEqual(['01', '03'])
        expect(await ids({ archived: false, or: [{ workspaceId: 'w2' }, { name: { ieq: 'ANA' } }] })).toEqual(['01', '03'])
        expect(await ids({ or: [{ and: [{ archived: true }, { rank: { gte: 2 } }] }, { id: '01' }] })).toEqual(['01', '02'])
        expect(await ids({ and: [{ rank: { gt: 1 } }, { or: [{ archived: true }, { workspaceId: 'w2' }] }] })).toEqual(['02', '03'])
        expect(await ids({ or: [] })).toEqual([])
        expect(await ids({ and: [] })).toEqual(['01', '02', '03'])
        expect(await things.count({ or: [{ rank: 1 }, { rank: 2 }] })).toBe(2)
      })

      test('keeps a JSON field as it was given: a string, a number, an object, a list', async () => {
        const values: unknown[] = ['hello', '123', 'null', 123, { a: [1, 'b'] }, ['x', 2], true]
        for (const [i, tags] of values.entries()) await things.insert(thing({ id: `0${i}`, tags: tags as string[] }))

        expect((await things.find()).map(row => row.tags as unknown)).toEqual(values)
      })

      test('tells a value with a trailing space from one without, and from a value with NUL', async () => {
        await things.insert(thing({ id: '01', name: 'ana' }))
        await things.insert(thing({ id: '02', name: 'ana ' }))
        const ids = async (criteria: Parameters<typeof things.find>[0]) => (await things.find(criteria)).map(row => row.id)

        expect(await ids({ name: 'ana' })).toEqual(['01'])
        expect(await ids({ name: { ieq: 'ANA' } })).toEqual(['01'])
        expect(await ids({ name: { in: ['ana ', 'ana\u0000'] } })).toEqual(['02'])
        expect(await ids({ id: '01\u0000' })).toEqual([])
        expect(await ids({ name: { ne: 'ana\u0000' } })).toEqual(['01', '02'])
        expect(await ids({ id: { gt: '01\u0000x' } })).toEqual(['02'])
        expect(await ids({ id: { lte: '01\u0000x' } })).toEqual(['01'])
      })

      test('sorts and compares text by code point, and null first going up, last going down', async () => {
        await things.insert(thing({ id: '01', name: 'bea', note: 'b' }))
        await things.insert(thing({ id: '02', name: 'Ana', note: null }))
        await things.insert(thing({ id: '03', name: 'cris', note: 'B' }))
        await things.insert(thing({ id: '04', name: 'Bob', note: 'a' }))
        const sorted = async (field: 'name' | 'note', direction?: 'asc' | 'desc') => (await things.find({}, { orderBy: [{ field, direction }] })).map(row => row.id)

        expect(await sorted('name')).toEqual(['02', '04', '01', '03'])
        expect(await sorted('name', 'desc')).toEqual(['03', '01', '04', '02'])
        expect(await sorted('note')).toEqual(['02', '03', '04', '01'])
        expect(await sorted('note', 'desc')).toEqual(['01', '04', '03', '02'])
        expect((await things.find({ name: { gt: 'Bob' } })).map(row => row.id)).toEqual(['01', '03'])
        expect((await things.find({ name: { lt: 'bea' } })).map(row => row.id)).toEqual(['02', '04'])
      })

      test('sorts, limits and counts', async () => {
        await things.insert(thing({ id: '01', rank: 2 }))
        await things.insert(thing({ id: '02', rank: 3 }))
        await things.insert(thing({ id: '03', rank: 1 }))

        expect((await things.find({}, { orderBy: [{ field: 'rank', direction: 'desc' }] })).map(row => row.id)).toEqual(['02', '01', '03'])
        expect((await things.find({}, { limit: 2 })).map(row => row.id)).toEqual(['01', '02'])
        expect(await things.count({ rank: { gte: 2 } })).toBe(2)
      })
    })

    describe('a table repository', () => {
      class Things extends TableRepository<Thing, ThingRow> {
        protected toEntity(row: ThingRow): Thing {
          return Thing.fromRow(row)
        }

        /** Saves them only if no two names start alike: a rule over several rows. */
        persistDistinctInitials(...entities: Thing[]): Promise<void> {
          return this.save(entities, entity => this.write(entity), {
            guard: ['things:initials'],
            after: async () => {
              const initials = (await this.table.find({ deletedAt: null })).map(row => row.name[0])
              if (new Set(initials).size < initials.length) throw new Error('two names start alike')
            },
          })
        }
      }

      const repository = () => new Things(new Base({ name: 'test', store }), things, { softDelete: true })

      test('pages newest first when told, the cursor going back', async () => {
        const repo = repository()
        for (const name of ['ana', 'bea', 'cris']) await repo.persist(Thing.create(name))

        const first = await repo.page({}, { size: 2 }, { newestFirst: true })
        const second = await repo.page({}, { size: 2, cursor: first.items.at(-1)!.id }, { newestFirst: true })

        expect(first.items.map(each => each.toDTO().name)).toEqual(['cris', 'bea'])
        expect(first.hasMore).toBe(true)
        expect(second.items.map(each => each.toDTO().name)).toEqual(['ana'])
        expect(second.hasMore).toBe(false)
      })

      test('saves a new one as version 1, and each change one on', async () => {
        const repo = repository()
        const ana = Thing.create('ana')
        await repo.persist(ana)
        ana.rename('bea')
        await repo.persist(ana)

        expect(ana.version).toBe(2)
        expect((await repo.find())[0]?.toDTO().name).toBe('bea')
      })

      test('leaves one with nothing to save as it is', async () => {
        const repo = repository()
        await repo.persist(Thing.create('ana'))
        const read = (await repo.first())!
        read.rename('ana')
        await repo.persist(read)

        expect(read.version).toBe(1)
      })

      test('refuses one changed by someone else since it was read, and writes nothing of the save', async () => {
        const repo = repository()
        await repo.persist(Thing.create('ana'))
        const mine = (await repo.first())!
        const theirs = (await repo.first())!
        theirs.rename('theirs')
        await repo.persist(theirs)

        mine.rename('mine')
        await expect(repo.persist(Thing.create('bea'), mine)).rejects.toBeInstanceOf(ConcurrencyConflict)
        expect((await repo.find()).map(each => each.toDTO().name)).toEqual(['theirs'])
      })

      test('leaves its entities unsaved when the transaction around the save rolls back', async () => {
        const repo = repository()
        const ana = Thing.create('ana')

        await expect(store.transaction(async () => {
          await repo.persist(ana)
          throw new Error('boom')
        })).rejects.toThrow('boom')

        expect([ana.isNew, ana.version]).toEqual([true, 0])
        await expect(repo.persist(ana)).rejects.toThrow(`Thing ${ana.id} was in a save that rolled back: read it again`)
        expect(await names()).toEqual([])
      })

      test('saved twice in the transaction around it, writes both, one version on each', async () => {
        const repo = repository()
        const ana = Thing.create('ana')

        await store.transaction(async () => {
          await repo.persist(ana)
          ana.rename('bea')
          await repo.persist(ana)
        })

        expect(ana.version).toBe(2)
        expect((await things.find()).map(row => [row.name, row.version])).toEqual([['bea', 2]])
      })

      test('a change after the save, in the transaction around it, is still to save', async () => {
        const repo = repository()
        const ana = Thing.create('ana')

        await store.transaction(async () => {
          await repo.persist(ana)
          ana.rename('bea')
        })
        expect([ana.version, ana.hasPendingChanges]).toEqual([1, true])
        await repo.persist(ana)

        expect((await things.find()).map(row => [row.name, row.version])).toEqual([['bea', 2]])
      })

      test('after the transaction around its save rolled back, one is saved again read again', async () => {
        const repo = repository()
        await repo.persist(Thing.create('ana'))
        const ana = (await repo.first())!
        ana.rename('bea')

        await expect(store.transaction(async () => {
          await repo.persist(ana)
          ana.rename('cris')
          throw new Error('boom')
        })).rejects.toThrow('boom')
        await expect(repo.persist(ana)).rejects.toThrow('rolled back')
        const again = (await repo.first())!
        again.rename('cris')
        await repo.persist(again)

        expect((await things.find()).map(row => [row.name, row.version])).toEqual([['cris', 2]])
      })

      test('stores a field cleared as none', async () => {
        const repo = repository()
        const ana = Thing.create('ana')
        ana.annotate('hi')
        await repo.persist(ana)
        ana.annotate(undefined)
        await repo.persist(ana)

        expect((await things.find())[0]?.note).toBeNull()
        expect((await repo.first())?.toDTO().note).toBeNull()
      })

      test('stamps the deleted ones, and finds them no more', async () => {
        const repo = repository()
        await repo.persist(Thing.create('ana'))
        const ana = (await repo.first())!
        ana.delete()
        await repo.persist(ana)

        expect(await repo.find()).toEqual([])
        expect(await repo.count()).toBe(0)
        expect((await things.find())[0]?.deletedAt).not.toBeNull()
      })

      test('pages by id, saying whether more follow and how many in all', async () => {
        const repo = repository()
        for (const name of ['a', 'b', 'c']) await repo.persist(Thing.create(name))

        const first = await repo.page({}, { size: 2 })
        const second = await repo.page({}, { size: 2, cursor: first.items.at(-1)!.id })
        expect(first.items.map(each => each.toDTO().name)).toEqual(['a', 'b'])
        expect([first.hasMore, first.total]).toEqual([true, 3])
        expect(second.items.map(each => each.toDTO().name)).toEqual(['c'])
        expect(second.hasMore).toBe(false)
      })

      test('a guard after the writes sees them, and throwing rolls all of it back', async () => {
        const repo = repository()
        await repo.persistDistinctInitials(Thing.create('ana'))

        await expect(repo.persistDistinctInitials(Thing.create('bea'), Thing.create('alba'))).rejects.toThrow('two names start alike')
        expect((await repo.find()).map(each => each.toDTO().name)).toEqual(['ana'])
      })

      test('publishes what they tell with the save, and nothing when it rolls back', async () => {
        const base = new Base({ name: 'test', store })
        const repo = new Things(base, things, { softDelete: true })
        const heard: string[] = []
        base.bus.subscribe('thing.created', event => { heard.push((event.payload as { name: string }).name) })

        await repo.persist(Thing.create('ana'))
        await expect(repo.persistDistinctInitials(Thing.create('alba'))).rejects.toThrow()
        await Bun.sleep(5)

        expect(heard).toEqual(['ana'])
      })
    })

    describe('a scoped table repository', () => {
      class Things extends TableRepository<Thing, ThingRow> {
        protected toEntity(row: ThingRow): Thing {
          return Thing.fromRow(row)
        }

        unarchived(): Promise<Thing[]> {
          return this.findInEveryScope({ archived: false })
        }

        purgeWorkspace(workspaceId: string): Promise<number> {
          return this.purge({ workspaceId })
        }
      }

      let current: string | undefined
      const repository = () => new Things(new Base({ name: 'test', store }), things, {
        scope: { field: 'workspaceId', current: () => current ?? (() => { throw new Error('no workspace here') })() },
      })

      test("finds, counts and pages only its scope's rows", async () => {
        const repo = repository()
        current = 'w1'
        await repo.persist(Thing.create('ana', 'w1'))
        current = 'w2'
        await repo.persist(Thing.create('bea', 'w2'), Thing.create('cris', 'w2'))

        expect((await repo.find()).map(each => each.toDTO().name).sort()).toEqual(['bea', 'cris'])
        expect(await repo.count({ name: 'ana' })).toBe(0)
        expect((await repo.page({}, { size: 10 })).total).toBe(2)
      })

      test('refuses to save an entity of another scope', async () => {
        current = 'w1'

        await expect(repository().persist(Thing.create('ana', 'w2'))).rejects.toThrow("not to the current one")
        expect(await things.count()).toBe(0)
      })

      test('pages newest first within its scope', async () => {
        const repo = repository()
        current = 'w1'
        for (const name of ['ana', 'bea', 'cris']) await repo.persist(Thing.create(name, 'w1'))
        current = 'w2'
        await repo.persist(Thing.create('dani', 'w2'))
        current = 'w1'

        const first = await repo.page({}, { size: 2 }, { newestFirst: true })
        const second = await repo.page({}, { size: 2, cursor: first.items.at(-1)!.id }, { newestFirst: true })

        expect(first.items.map(each => each.toDTO().name)).toEqual(['cris', 'bea'])
        expect(first.total).toBe(3)
        expect(second.items.map(each => each.toDTO().name)).toEqual(['ana'])
      })

      test('finds across scopes only when asked to', async () => {
        const repo = repository()
        current = 'w1'
        await repo.persist(Thing.create('ana', 'w1'))
        current = 'w2'
        await repo.persist(Thing.create('bea', 'w2'))
        current = undefined

        expect((await repo.unarchived()).map(each => each.toDTO().workspaceId).sort()).toEqual(['w1', 'w2'])
      })

      test('purges a scope\'s rows from outside it, the deleted ones too, and leaves the others', async () => {
        const repo = repository()
        current = 'w1'
        await repo.persist(Thing.create('ana', 'w1'))
        await things.insert(thing({ name: 'bea', workspaceId: 'w1', deletedAt: new Date().toISOString() }))
        current = 'w2'
        await repo.persist(Thing.create('cris', 'w2'))
        current = undefined

        expect(await repo.purgeWorkspace('w1')).toBe(2)
        expect(await names()).toEqual(['cris'])
      })

      test('cannot be used outside a scope', async () => {
        current = undefined

        await expect(repository().find()).rejects.toThrow('no workspace here')
      })
    })

    describe('closing', () => {
      test('waits for the transactions in progress', async () => {
        const log: string[] = []
        const running = store.transaction(async () => {
          await Bun.sleep(20)
          log.push('transaction ended')
        })
        await Bun.sleep(1)

        await store.close()
        log.push('closed')
        await running
        store = await fixture.open()

        expect(log).toEqual(['transaction ended', 'closed'])
      })
    })

    describe('guards in any order', () => {
      test('two transactions guarding the same keys in another order both end', async () => {
        const hold = (keys: string[]) => store.transaction(async () => {
          await store.guard(keys)
          await Bun.sleep(5)
        })

        await Promise.all(Array.from({ length: 5 }, () => [hold(['k1', 'k2']), hold(['k2', 'k1'])]).flat())
      })
    })

    describe('the outbox', () => {
      const job = (queue: string) => {
        const now = new Date().toISOString()
        return { id: Bun.randomUUIDv7(), queue, event: '{}', status: 'pending' as const, attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now }
      }

      test('keeps the jobs written in a transaction that rolls back: none', async () => {
        await expect(store.transaction(async () => {
          await store.outbox.add([job('a.b.on.c')])
          throw new Error('boom')
        })).rejects.toThrow('boom')

        expect(await store.outbox.list()).toEqual([])
      })

      test('hands a job to one claim only, and closes it only from that claim', async () => {
        await store.outbox.add([job('a.b.on.c')])
        const later = new Date(Date.now() + 60_000).toISOString()

        const [claimed] = await store.outbox.claim(['a.b.on.c'], 10, 'w1', later)
        expect(await store.outbox.claim(['a.b.on.c'], 10, 'w2', later)).toEqual([])
        await store.outbox.renew(claimed!, '2000-01-01T00:00:00.000Z')
        const [again] = await store.outbox.claim(['a.b.on.c'], 10, 'w2', later)
        await store.outbox.close(claimed!, { status: 'done', lastError: null })

        expect(again?.attempts).toBe(2)
        expect((await store.outbox.list())[0]).toMatchObject({ status: 'running', attempts: 2, lockedBy: 'w2' })
      })

      test('counts the jobs of each queue still to run, and only those', async () => {
        await store.outbox.add([job('a.b.on.c'), job('a.b.on.c'), job('d.e.on.f'), job('g.h.on.i')])
        const [claimed] = await store.outbox.claim(['g.h.on.i'], 1, 'w1', new Date(Date.now() + 60_000).toISOString())
        await store.outbox.close(claimed!, { status: 'done', lastError: null })
        await store.outbox.claim(['d.e.on.f'], 1, 'w1', new Date(Date.now() + 60_000).toISOString())

        expect(await store.outbox.waiting()).toEqual([{ queue: 'a.b.on.c', jobs: 2 }, { queue: 'd.e.on.f', jobs: 1 }])
      })

      test('puts a dead job back to wait, as new, and leaves any other as it is', async () => {
        const dead = job('a.b.on.c')
        const alive = job('a.b.on.c')
        await store.outbox.add([dead, alive])
        const [claimed] = await store.outbox.claim(['a.b.on.c'], 1, 'w1', new Date(Date.now() + 60_000).toISOString())
        await store.outbox.close(claimed!, { status: 'dead', lastError: 'boom' })

        expect(await store.outbox.retry(claimed!.id)).toBe(true)
        expect(await store.outbox.retry(claimed!.id)).toBe(false)
        expect(await store.outbox.retry('none')).toBe(false)
        const retried = (await store.outbox.list()).find(each => each.id === claimed!.id)
        expect(retried).toMatchObject({ status: 'pending', attempts: 0, lockedBy: null, lockedUntil: null, lastError: 'boom' })
        expect((await store.outbox.claim(['a.b.on.c'], 10, 'w2', new Date(Date.now() + 60_000).toISOString())).map(each => each.id).sort()).toEqual([dead.id, alive.id].sort())
      })

      test('remembers the queues and forgets jobs done long ago', async () => {
        await store.outbox.seen([{ name: 'a.b.on.c', event: 'c', attempts: 3 }])
        await store.outbox.add([job('a.b.on.c')])
        const [claimed] = await store.outbox.claim(['a.b.on.c'], 1, 'w1', new Date(Date.now() + 60_000).toISOString())
        await store.outbox.close(claimed!, { status: 'done', lastError: null })
        await store.outbox.purge(new Date(Date.now() + 1_000).toISOString())

        expect(await store.outbox.queues()).toEqual([{ name: 'a.b.on.c', event: 'c', attempts: 3, lastSeenAt: expect.any(String) }])
        expect(await store.outbox.list()).toEqual([])
      })

      const lease = () => new Date(Date.now() + 60_000).toISOString()
      const at = (ms: number) => new Date(Date.now() + ms).toISOString()

      test('claims up to its limit, the ones due first first, of its queues only', async () => {
        await store.outbox.add([
          { ...job('a.b.on.c'), id: 'later', runAfter: at(-1_000) },
          { ...job('a.b.on.c'), id: 'first', runAfter: at(-3_000) },
          { ...job('a.b.on.c'), id: 'second', runAfter: at(-2_000) },
          { ...job('x.y.on.z'), id: 'other' },
          { ...job('a.b.on.c'), id: 'not-yet', runAfter: at(60_000) },
        ])

        expect((await store.outbox.claim(['a.b.on.c'], 1, 'w1', lease())).map(each => each.id)).toEqual(['first'])
        expect((await store.outbox.claim(['a.b.on.c'], 1, 'w1', lease())).map(each => each.id)).toEqual(['second'])
        expect((await store.outbox.claim(['a.b.on.c'], 2, 'w1', lease())).map(each => each.id)).toEqual(['later'])
      })

      test('two claims at once never take the same job', async () => {
        await store.outbox.add([{ ...job('a.b.on.c'), id: 'one' }, { ...job('a.b.on.c'), id: 'two' }])

        // A database may give one of them up (a deadlock): it is a conflict, retried at the next poll.
        const outcomes = await Promise.allSettled([
          store.outbox.claim(['a.b.on.c'], 1, 'w1', lease()),
          store.outbox.claim(['a.b.on.c'], 1, 'w2', lease()),
        ])

        const claimed = outcomes.flatMap(outcome => (outcome.status === 'fulfilled' ? outcome.value : [])).map(each => each.id)
        for (const outcome of outcomes) if (outcome.status === 'rejected') expect(outcome.reason).toBeInstanceOf(ConcurrencyConflict)
        expect(claimed.length).toBeGreaterThan(0)
        expect(new Set(claimed).size).toBe(claimed.length)
      })

      test('closing a claim to retry moves when it runs, and frees it', async () => {
        await store.outbox.add([job('a.b.on.c')])
        const [claimed] = await store.outbox.claim(['a.b.on.c'], 1, 'w1', lease())
        const retry = at(30_000)

        await store.outbox.close(claimed!, { status: 'pending', lastError: 'boom', runAfter: retry })

        expect((await store.outbox.list())[0]).toMatchObject({ status: 'pending', lastError: 'boom', runAfter: retry, lockedBy: null, lockedUntil: null })
      })

      test('a claim already closed changes nothing more', async () => {
        await store.outbox.add([job('a.b.on.c')])
        const [claimed] = await store.outbox.claim(['a.b.on.c'], 1, 'w1', lease())
        await store.outbox.close(claimed!, { status: 'done', lastError: null })

        await store.outbox.close(claimed!, { status: 'dead', lastError: 'late' })
        await store.outbox.renew(claimed!, at(120_000))

        expect((await store.outbox.list())[0]).toMatchObject({ status: 'done', lastError: null, lockedUntil: null })
      })

      test('a claim from before a retry closes nothing of the claim after it', async () => {
        await store.outbox.add([job('a.b.on.c')])
        const [stale] = await store.outbox.claim(['a.b.on.c'], 1, 'A/1', at(-1_000))
        const [buried] = await store.outbox.claim(['a.b.on.c'], 1, 'B/1', lease())
        await store.outbox.close(buried!, { status: 'dead', lastError: 'gave up' })
        await store.outbox.retry(stale!.id)
        await store.outbox.claim(['a.b.on.c'], 1, 'C/1', lease())

        await store.outbox.renew(stale!, at(120_000))
        await store.outbox.close(stale!, { status: 'dead', lastError: 'stale' })

        expect((await store.outbox.list())[0]).toMatchObject({ status: 'running', attempts: 1, lockedBy: 'C/1', lastError: 'gave up' })
      })

      test('purges only jobs done: pending, running and dead ones stay', async () => {
        await store.outbox.add([{ ...job('a.b.on.c'), id: 'pending' }, { ...job('a.b.on.c'), id: 'dead' }, { ...job('a.b.on.c'), id: 'running' }])
        const claimed = await store.outbox.claim(['a.b.on.c'], 2, 'w1', lease())
        await store.outbox.close(claimed.find(each => each.id === 'dead') ?? claimed[0]!, { status: 'dead', lastError: 'gave up' })

        await store.outbox.purge(at(1_000))

        expect((await store.outbox.list()).length).toBe(3)
      })

      test('purges only what was done before the time it is given', async () => {
        await store.outbox.add([job('a.b.on.c')])
        const [claimed] = await store.outbox.claim(['a.b.on.c'], 1, 'w1', lease())
        await store.outbox.close(claimed!, { status: 'done', lastError: null })

        await store.outbox.purge(at(-60_000))

        expect(await store.outbox.list()).toHaveLength(1)
      })

      test('renewing and closing a claim say when they changed it', async () => {
        await store.outbox.add([{ ...job('a.b.on.c'), updatedAt: at(-60_000) }])
        const [claimed] = await store.outbox.claim(['a.b.on.c'], 1, 'w1', lease())
        const claimedAt = (await store.outbox.list())[0]!.updatedAt
        await Bun.sleep(5)
        await store.outbox.renew(claimed!, lease())
        const renewedAt = (await store.outbox.list())[0]!.updatedAt
        await Bun.sleep(5)
        await store.outbox.close(claimed!, { status: 'done', lastError: null })

        expect(renewedAt > claimedAt).toBe(true)
        expect((await store.outbox.list())[0]!.updatedAt > renewedAt).toBe(true)
      })

      test('lists the queues by name', async () => {
        await store.outbox.seen([{ name: 'z.b.on.c', event: 'c', attempts: 1 }, { name: 'a.b.on.c', event: 'c', attempts: 1 }])

        expect((await store.outbox.queues()).map(queue => queue.name)).toEqual(['a.b.on.c', 'z.b.on.c'])
      })

      test('a queue seen again says what it is now, and when', async () => {
        await store.outbox.seen([{ name: 'a.b.on.c', event: 'c', attempts: 3 }])
        const [first] = await store.outbox.queues()
        await Bun.sleep(5)
        await store.outbox.seen([{ name: 'a.b.on.c', event: 'c.*', attempts: 5 }])

        const [again] = await store.outbox.queues()
        expect(again).toMatchObject({ name: 'a.b.on.c', event: 'c.*', attempts: 5 })
        expect(again!.lastSeenAt > first!.lastSeenAt).toBe(true)
      })

      test('lists the jobs oldest first', async () => {
        await store.outbox.add([{ ...job('a.b.on.c'), id: 'a', createdAt: at(-1_000) }, { ...job('a.b.on.c'), id: 'b', createdAt: at(-2_000) }])

        expect((await store.outbox.list()).map(each => each.id)).toEqual(['b', 'a'])
      })
    })

    describe('the job queue', () => {
      const start = (queue: JobQueue) => {
        queue.start()
        queues.push(queue)
        return queue
      }
      /** A use case that saves a thing, and publishes it, in one transaction, the way a repository does. */
      const add = (publish: (event: DomainEvent) => void | Promise<void>, name: string, fail = false) => store.transaction(async () => {
        await things.insert(thing({ name }))
        await publish({ name: 'thing.added', payload: { name }, occurredAt: new Date().toISOString() })
        if (fail) throw new Error('boom')
      })
      const jobs = () => store.outbox.list()

      test('runs a handler after the commit, woken by it, and its job ends done', async () => {
        const base = new Base({ name: 'test', store })
        const seen: unknown[] = []
        base.bus.subscribe('thing.added', event => { seen.push(event.payload) }, { mode: 'handler', name: 'thing.welcome.on.thing.added' })
        start(base.jobs)
        await Bun.sleep(20)

        await add(event => base.publisher.publish(event), 'ada')

        await until(async () => (await jobs())[0]?.status === 'done', 1_000)
        expect(seen).toEqual([{ name: 'ada' }])
        expect((await jobs())[0]).toMatchObject({ queue: 'thing.welcome.on.thing.added', status: 'done', attempts: 1, lastError: null })
      })

      test('leaves no job behind when the save rolls back', async () => {
        const base = new Base({ name: 'test', store })
        base.bus.subscribe('thing.added', () => {}, { mode: 'handler', name: 'thing.welcome.on.thing.added' })

        await expect(add(event => base.publisher.publish(event), 'ada', true)).rejects.toThrow('boom')
        await base.jobs.idle()

        expect(await jobs()).toEqual([])
      })

      test('tries a failing one again later, and buries it once out of attempts', async () => {
        const base = new Base({ name: 'test', store })
        const queue = new JobQueue(store.outbox, base.invocations, { pollMs: 5, backoffMs: 1 })
        let calls = 0
        queue.register('thing.welcome.on.thing.added', 'thing.added', () => {
          calls++
          throw new Error('smtp down')
        }, 3)
        start(queue)

        await add(event => queue.enqueue(event), 'ada')

        await until(async () => (await jobs())[0]?.status === 'dead')
        expect(calls).toBe(3)
        expect((await jobs())[0]).toMatchObject({ status: 'dead', attempts: 3 })
        expect((await jobs())[0]!.lastError).toContain('smtp down')
      })

      test('does not let a slow job hold the others back', async () => {
        const base = new Base({ name: 'test', store })
        const queue = new JobQueue(store.outbox, base.invocations, { pollMs: 5 })
        const done: string[] = []
        let resumeSlow: (() => void) | undefined
        queue.register('thing.welcome.on.thing.added', 'thing.added', async event => {
          const { name } = event.payload as { name: string }
          if (name === 'slow') await new Promise<void>(resolve => { resumeSlow = resolve })
          done.push(name)
        })
        start(queue)

        await add(event => queue.enqueue(event), 'slow')
        await until(async () => resumeSlow !== undefined)
        await add(event => queue.enqueue(event), 'quick')

        await until(async () => done.includes('quick'))
        resumeSlow!()
        await until(async () => done.length === 2)
        expect(done).toEqual(['quick', 'slow'])
      })

      test('lets another worker take a job whose lease ran out, and the first cannot close it then', async () => {
        const base = new Base({ name: 'test', store })
        // One job at a time: busy with it, it claims nothing else, not even that one again.
        const gone = new JobQueue(store.outbox, base.invocations, { pollMs: 5, concurrency: 1 })
        const next = new JobQueue(store.outbox, base.invocations, { pollMs: 5 })
        let enteredFirst = false
        let enteredSecond = false
        let resumeFirst!: () => void
        let resumeSecond!: () => void
        gone.register('thing.welcome.on.thing.added', 'thing.added', async () => {
          enteredFirst = true
          await new Promise<void>(resolve => { resumeFirst = resolve })
          throw new Error('too late')
        })
        next.register('thing.welcome.on.thing.added', 'thing.added', async () => {
          enteredSecond = true
          await new Promise<void>(resolve => { resumeSecond = resolve })
        })

        await add(event => gone.enqueue(event), 'ada')
        start(gone)
        await until(async () => enteredFirst)
        // Its worker stopped renewing it: the lease runs out, and another one claims it.
        for (const each of await jobs()) await store.outbox.renew(each, '2000-01-01T00:00:00.000Z')
        start(next)
        await until(async () => enteredSecond)

        resumeFirst()
        await gone.stop()
        expect((await jobs())[0]).toMatchObject({ status: 'running', attempts: 2, lastError: null })

        resumeSecond()
        await until(async () => (await jobs())[0]?.status === 'done')
      })

      test('warns at start about jobs of a queue nobody serves', async () => {
        const now = new Date().toISOString()
        await store.outbox.add([{ id: Bun.randomUUIDv7(), queue: 'thing.gone.on.thing.added', event: '{}', status: 'pending', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now }])
        const base = new Base({ name: 'test', store })
        base.bus.subscribe('thing.added', () => {}, { mode: 'handler', name: 'thing.welcome.on.thing.added' })
        const warnings: string[] = []
        const original = console.warn
        console.warn = (message: string) => { warnings.push(message) }
        try {
          start(base.jobs)
          await until(async () => warnings.length > 0)
        } finally {
          console.warn = original
        }

        expect(warnings).toEqual([expect.stringContaining("'thing.gone.on.thing.added'")])
      })

      test('registers the queues it runs, as alive', async () => {
        const base = new Base({ name: 'test', store })
        base.bus.subscribe('thing.added', () => {}, { mode: 'handler', name: 'thing.welcome.on.thing.added', attempts: 3 })

        start(base.jobs)

        await until(async () => (await store.outbox.queues()).length === 1)
        expect(await store.outbox.queues()).toEqual([{ name: 'thing.welcome.on.thing.added', event: 'thing.added', attempts: 3, lastSeenAt: expect.any(String) }])
      })
    })
  })
}

/** How the suite's table is described to any store: the same words for all of them. */
const THING: TableOptions<ThingRow> = { types: { archived: 'boolean', tags: 'json' }, unique: [['name']] }

const ThingSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  archived: z.boolean(),
  rank: z.number(),
  note: z.string().nullish(),
  tags: z.array(z.string()),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})
type ThingDTO = z.infer<typeof ThingSchema>

class Thing extends Entity<typeof ThingSchema> {
  static create(name: string, workspaceId = 'w1'): Thing {
    const thing = new Thing(ThingSchema, { workspaceId, name, archived: false, rank: 0, note: null, tags: [] } as EntityInput<ThingDTO>, true)
    thing.trackEvent({ name: 'thing.created', payload: { name }, occurredAt: new Date().toISOString() })
    return thing
  }

  static fromRow(row: ThingDTO & { version: number }): Thing {
    return new Thing(ThingSchema, row, false)
  }

  rename(name: string): void {
    this.change({ name })
  }

  annotate(note: string | undefined): void {
    this.change({ note })
  }

  delete(): void {
    this.markAsDeleted()
  }
}

async function until(condition: () => Promise<boolean>, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting')
    await Bun.sleep(2)
  }
}
