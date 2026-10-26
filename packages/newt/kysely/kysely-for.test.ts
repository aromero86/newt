import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SqliteStore } from '../adapter-sqlite'
import { kyselyFor } from './kysely-for'
import type { SqliteRow } from './sqlite-row'

type MovementRow = { id: string, productId: string, quantity: number, done: boolean, version: number }
type Database = { stock_movement: SqliteRow<MovementRow> }

let store: SqliteStore

beforeEach(async () => {
  store = await SqliteStore.open({ path: ':memory:' })
  await store.transaction(() => store.connection.run('CREATE TABLE stock_movement (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, quantity INTEGER NOT NULL, done INTEGER NOT NULL, version INTEGER NOT NULL)'))
})

afterEach(() => store.close())

describe('kyselyFor', () => {
  test('queries the store with the rows\' field names', async () => {
    const db = kyselyFor<Database>(store)
    const movements = store.table<MovementRow>('stock_movement', { types: { done: 'boolean' } })
    await movements.insert({ id: 'm1', productId: 'oil', quantity: 5, done: false })
    await movements.insert({ id: 'm2', productId: 'oil', quantity: -2, done: true })

    const level = await db.selectFrom('stock_movement').select(eb => eb.fn.sum<number>('quantity').as('level')).where('productId', '=', 'oil').executeTakeFirstOrThrow()

    expect(level).toEqual({ level: 3 })
  })

  test('writes inside the store\'s transaction, and sees what it wrote there', async () => {
    const db = kyselyFor<Database>(store)

    await store.transaction(async () => {
      await db.insertInto('stock_movement').values({ id: 'm1', productId: 'oil', quantity: 1, done: 0, version: 1 }).execute()
      expect(await db.selectFrom('stock_movement').selectAll().execute()).toHaveLength(1)
    })
    expect(await db.selectFrom('stock_movement').select('productId').execute()).toEqual([{ productId: 'oil' }])
  })

  test('tells how many rows a write changed, and the row it inserted', async () => {
    const db = kyselyFor<Database>(store)

    const inserted = await store.transaction(() => db.insertInto('stock_movement').values({ id: 'm1', productId: 'oil', quantity: 1, done: 0, version: 1 }).executeTakeFirstOrThrow())
    await store.transaction(() => db.insertInto('stock_movement').values({ id: 'm2', productId: 'oil', quantity: 2, done: 0, version: 1 }).execute())
    const updated = await store.transaction(() => db.updateTable('stock_movement').set({ done: 1 }).where('productId', '=', 'oil').executeTakeFirstOrThrow())

    expect(inserted.insertId).toBe(1n)
    expect(updated.numUpdatedRows).toBe(2n)
  })

  test('refuses a write outside a transaction, and transactions of its own', async () => {
    const db = kyselyFor<Database>(store)

    await expect(db.insertInto('stock_movement').values({ id: 'm1', productId: 'oil', quantity: 1, done: 0, version: 1 }).execute()).rejects.toThrow('store.transaction')
    await expect(db.transaction().execute(async () => {})).rejects.toThrow('store.transaction')
  })
})
