import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { SqliteStore } from '../adapter-sqlite'
import { SqliteStatements } from './sqlite-statements'

describe('SqliteStatements', () => {
  test('prepares one per SQL, keeps the 200 used last, and finalizes the one it lets go', () => {
    const finalized: string[] = []
    const prepared: string[] = []
    const connection = {
      prepare: (sql: string) => {
        prepared.push(sql)
        return { finalize: () => finalized.push(sql) }
      },
    } as unknown as Database
    const statements = new SqliteStatements(connection)

    for (let i = 0; i < 200; i++) statements.get(`select ${i}`)
    statements.get('select 0')
    statements.get('select 200')

    expect(prepared).toHaveLength(201)
    expect(finalized).toEqual(['select 1'])
    statements.finalize()
    expect(finalized).toHaveLength(201)
  })

  describe('on a store', () => {
    let store: SqliteStore

    beforeEach(async () => {
      store = await SqliteStore.open({ path: ':memory:' })
      await store.transaction(() => store.connection.run('CREATE TABLE item (id TEXT PRIMARY KEY)'))
    })

    afterEach(() => store.close())

    test('one statement reads committed rows outside a transaction, and what it wrote inside one', async () => {
      const statements = new SqliteStatements(store.connection)
      const ids = () => (statements.get('SELECT id FROM item ORDER BY id').all() as { id: string }[]).map(row => row.id)

      expect(ids()).toEqual([])
      await store.transaction(() => {
        statements.get('INSERT INTO item (id) VALUES (?)').run('a')
        expect(ids()).toEqual(['a'])
      })
      expect(ids()).toEqual(['a'])
    })
  })
})
