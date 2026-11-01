import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { SqliteStore } from 'newt-kit/adapter-sqlite'
import { describeAnalyticsContract } from 'newt-kit/port-analytics/contract'
import { SqlAnalytics } from './sql-analytics'

/** A store of its own, in memory, with the analytics table and nothing else. */
const openStore = () => SqliteStore.open({ path: ':memory:', migrations: join(import.meta.dir, 'migrations/sqlite') })

const stores: SqliteStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()))
})

async function open(): Promise<SqlAnalytics> {
  const store = await openStore()
  stores.push(store)
  return new SqlAnalytics(store)
}

describeAnalyticsContract('SqlAnalytics', {
  open,
  rows: (analytics, dataset) => analytics.rows(dataset),
})

describe('SqlAnalytics', () => {
  test('counts a dataset, and its rows by the value of a field, from one on', async () => {
    const analytics = await open()
    await analytics.append('card_created', [
      { id: 'c1', day: '2026-10-01' },
      { id: 'c2', day: '2026-10-03' },
      { id: 'c3', day: '2026-10-03' },
      { id: 'c4', day: '2026-09-30' },
    ])
    await analytics.append('workspace_created', [{ id: 'w1', day: '2026-10-03' }])

    expect(await analytics.count('card_created')).toBe(4)
    expect(await analytics.countBy('card_created', 'day', { from: '2026-10-01' })).toEqual([
      { value: '2026-10-01', count: 1 },
      { value: '2026-10-03', count: 2 },
    ])
    expect(await analytics.countBy('nothing', 'day')).toEqual([])
  })

  test('never takes a field that is not a name', async () => {
    const analytics = await open()
    await expect(analytics.countBy('card_created', 'day\') OR 1=1 --')).rejects.toThrow('is not a field')
  })
})
