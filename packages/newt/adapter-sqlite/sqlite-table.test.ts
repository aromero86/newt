import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SqliteStore } from './sqlite-store'
import type { SqliteTable } from './sqlite-table'

type GadgetRow = { id: string, version: number, label: string, flag: boolean | null, data: { size: number } | null }

let store: SqliteStore
let gadgets: SqliteTable<GadgetRow>

/** The row as SQLite keeps it, columns and all. */
const raw = () => store.connection.prepare('SELECT * FROM gadget').get() as Record<string, unknown>

beforeEach(async () => {
  store = await SqliteStore.open({ path: ':memory:' })
  await store.transaction(() => {
    store.connection.run('CREATE TABLE gadget (id TEXT PRIMARY KEY, version INTEGER NOT NULL, the_label TEXT NOT NULL, flag INTEGER, data TEXT)')
  })
  gadgets = store.table<GadgetRow>('gadget', { types: { flag: 'boolean', data: 'json' }, columns: { label: 'the_label' } })
})

afterEach(() => store.close())

describe('a SQL table', () => {
  test('writes and reads a field in the column it is told, both ways', async () => {
    await gadgets.insert({ id: 'g1', label: 'lamp', flag: true, data: { size: 2 } })

    expect(raw()).toMatchObject({ the_label: 'lamp', flag: 1, data: '{"size":2}' })
    expect(await gadgets.find({ label: 'lamp' })).toEqual([{ id: 'g1', version: 1, label: 'lamp', flag: true, data: { size: 2 } }])
  })

  test('keeps a typed field with nothing in it as NULL, and reads it back as null', async () => {
    await gadgets.insert({ id: 'g1', label: 'lamp', flag: null, data: null })

    expect(raw()).toMatchObject({ flag: null, data: null })
    expect((await gadgets.find())[0]).toMatchObject({ flag: null, data: null })
  })

  test('an update never changes the id, and leaves alone what it does not say', async () => {
    await gadgets.insert({ id: 'g1', label: 'lamp', flag: true, data: null })

    await gadgets.update('g1', 1, { id: 'other', label: undefined, flag: false } as never)

    expect(raw()).toMatchObject({ id: 'g1', version: 2, the_label: 'lamp', flag: 0 })
  })

  test('a patch never changes the version, and with nothing to write writes nothing', async () => {
    await gadgets.insert({ id: 'g1', label: 'lamp', flag: true, data: null })

    await gadgets.patch('g1', { label: 'bulb', version: 9 } as never)
    await gadgets.patch('g1', {})
    await gadgets.patch('g1', { label: undefined })

    expect(raw()).toMatchObject({ version: 1, the_label: 'bulb' })
  })
})
