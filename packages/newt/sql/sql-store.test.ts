import { describe, expect, test } from 'bun:test'
import type { ReservedSQL, SQL } from 'bun'
import { postgresDialect } from '../adapter-postgres/postgres-dialect'
import { SqlStore } from './sql-store'

/** A store on a pool that hands out one connection, which fails its BEGIN. */
class FailingBeginStore extends SqlStore {
  static on(sql: SQL): FailingBeginStore {
    return new FailingBeginStore(sql, postgresDialect, { url: 'postgres://fake' })
  }
}

describe('SqlStore', () => {
  test('a BEGIN that fails releases the connection it reserved', async () => {
    const statements: string[] = []
    let released = 0
    const connection = {
      unsafe: async (text: string) => {
        statements.push(text)
        if (text === 'BEGIN') throw new Error('the connection broke')
        return []
      },
      release: () => { released++ },
    } as unknown as ReservedSQL
    const sql = { reserve: async () => connection } as unknown as SQL
    const store = FailingBeginStore.on(sql)

    await expect(store.transaction(() => 1)).rejects.toThrow('the connection broke')

    expect(released).toBe(1)
    expect(statements).toEqual(['BEGIN', 'ROLLBACK'])
  })
})
