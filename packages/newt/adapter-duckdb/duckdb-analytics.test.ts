import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeAnalyticsContract } from '../port-analytics/contract'
import { DuckDbAnalytics } from './duckdb-analytics'

describeAnalyticsContract('DuckDbAnalytics', {
  open: () => DuckDbAnalytics.open({ path: ':memory:' }),
  rows: (analytics, dataset) => analytics.rows(dataset),
})

describe('DuckDbAnalytics, with a dataset of its own columns', () => {
  let analytics: DuckDbAnalytics | undefined

  afterEach(async () => {
    await analytics?.close()
    analytics = undefined
  })

  const open = () => DuckDbAnalytics.open({
    path: ':memory:',
    datasets: { event_minute: { columns: { minute: 'TIMESTAMP', event: 'VARCHAR', count: 'INTEGER' } } },
  })

  test('keeps its rows as columns, and reads them grouped by time', async () => {
    analytics = await open()
    await analytics.append('event_minute', [
      { id: '1', minute: '2026-01-01T10:00:00.000Z', event: 'card.created', count: 3 },
      { id: '2', minute: '2026-01-01T10:04:00.000Z', event: 'card.created', count: 2 },
      { id: '3', minute: '2026-01-01T10:07:00.000Z', event: 'card.created', count: 1 },
    ])
    // The same rows again: a pull that came twice adds nothing.
    await analytics.append('event_minute', [{ id: '1', minute: '2026-01-01T10:00:00.000Z', event: 'card.created', count: 3 }])

    const buckets = await analytics.query(
      `SELECT time_bucket(INTERVAL 5 MINUTE, minute) AS bucket, sum(count) AS total FROM event_minute WHERE event = $1 GROUP BY bucket ORDER BY bucket`,
      ['card.created'],
    )
    expect(buckets).toEqual([{ bucket: '2026-01-01T10:00:00.000Z', total: 5 }, { bucket: '2026-01-01T10:05:00.000Z', total: 1 }])
  })

  test('forgets what it is told to, and refuses a name that is not one', async () => {
    analytics = await open()
    await analytics.append('event_minute', [{ id: '1', minute: '2026-01-01T10:00:00.000Z', event: 'a', count: 1 }])
    await analytics.run(`DELETE FROM event_minute WHERE minute < $1`, ['2026-01-02T00:00:00.000Z'])

    expect(await analytics.rows('event_minute')).toEqual([])
    await expect(analytics.append('drop table x', [{ id: '1' }])).rejects.toThrow(/not a name/)
  })
})

describe('DuckDbAnalytics, declared again', () => {
  let folder: string | undefined

  afterEach(async () => {
    if (folder) await rm(folder, { recursive: true, force: true })
    folder = undefined
  })

  test('adds a column declared later to the table already in its file', async () => {
    folder = await mkdtemp(join(tmpdir(), 'newt-duckdb-'))
    const path = join(folder, 'analytics.duckdb')
    const first = await DuckDbAnalytics.open({ path, datasets: { m: { columns: { x: 'INTEGER' } } } })
    await first.append('m', [{ id: '1', x: 1 }])
    await first.close()

    const second = await DuckDbAnalytics.open({ path, datasets: { m: { columns: { x: 'INTEGER', y: 'INTEGER' } } } })
    await second.append('m', [{ id: '2', x: 1, y: 2 }])
    expect(await second.rows('m')).toEqual([{ id: '1', x: 1, y: null }, { id: '2', x: 1, y: 2 }])
    await second.close()

    const third = await DuckDbAnalytics.open({ path, datasets: { m: { columns: { x: 'VARCHAR', y: 'INTEGER' } } } }).catch((error: Error) => error)
    expect(third).toBeInstanceOf(Error)
    expect((third as Error).message).toMatch(/m\.x is INTEGER in its file, not VARCHAR/)
  })
})

describe('DuckDbAnalytics, names', () => {
  test('takes a reserved word as a dataset or a column', async () => {
    const analytics = await DuckDbAnalytics.open({ path: ':memory:', datasets: { order: { columns: { from: 'VARCHAR', select: 'INTEGER' } } } })
    await analytics.append('order', [{ id: '1', from: 'a', select: 2 }])
    await analytics.append('group', [{ id: '1', value: 3 }])
    expect(await analytics.rows('order')).toEqual([{ id: '1', from: 'a', select: 2 }])
    expect(await analytics.rows('group')).toEqual([{ id: '1', value: 3 }])
    await analytics.close()
  })

  test('refuses names that differ only in case', async () => {
    await expect(DuckDbAnalytics.open({
      path: ':memory:',
      datasets: { Sales: { columns: { total: 'INTEGER' } }, sales: { columns: { total: 'INTEGER' } } },
    })).rejects.toThrow(/differ only in case/)
    await expect(DuckDbAnalytics.open({
      path: ':memory:',
      datasets: { sales: { columns: { Total: 'INTEGER', total: 'INTEGER' } } },
    })).rejects.toThrow(/differ only in case/)

    const analytics = await DuckDbAnalytics.open({ path: ':memory:', datasets: { sales: { columns: { total: 'INTEGER' } } } })
    await expect(analytics.append('Sales', [{ id: '1' }])).rejects.toThrow(/differ only in case/)
    await analytics.close()
  })
})

describe('DuckDbAnalytics, closed', () => {
  test('runs what it was given before closing, and refuses what comes after, instead of crashing', async () => {
    const analytics = await DuckDbAnalytics.open({ path: ':memory:' })
    const before = analytics.query<{ one: number }>('SELECT 1 AS one')
    const closing = analytics.close()
    expect(await before).toEqual([{ one: 1 }])
    await expect(analytics.query('SELECT 1')).rejects.toThrow('The analytics is closed')
    await expect(analytics.run('SELECT 1')).rejects.toThrow('The analytics is closed')
    await Promise.all([closing, analytics.close()])
  })
})
