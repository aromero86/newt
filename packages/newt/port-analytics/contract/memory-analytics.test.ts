import { describe, expect, test } from 'bun:test'
import { describeAnalyticsContract } from './describe-analytics-contract'
import { MemoryAnalytics } from './memory-analytics'

describeAnalyticsContract('MemoryAnalytics', {
  open: async () => new MemoryAnalytics(),
  rows: (analytics, dataset) => analytics.rows(dataset),
})

describe('MemoryAnalytics', () => {
  test('keeps a copy: changing a row after appending it changes nothing', async () => {
    const analytics = new MemoryAnalytics()
    const row = { id: 's1', units: 2 }

    await analytics.append('sales', [row])
    row.units = 9

    expect(await analytics.rows('sales')).toEqual([{ id: 's1', units: 2 }])
  })
})
