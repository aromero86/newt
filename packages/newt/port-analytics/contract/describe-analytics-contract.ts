import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Analytics } from '../../port-analytics'
import type { AnalyticsFixture } from './analytics-fixture'

/** Checks an analytics adapter keeps what `Analytics` promises. */
export function describeAnalyticsContract<A extends Analytics>(name: string, fixture: AnalyticsFixture<A>): void {
  describe(`${name} keeps the Analytics contract`, () => {
    let analytics: A

    beforeEach(async () => {
      analytics = await fixture.open()
    })

    afterEach(() => analytics.close())

    const byId = async (dataset: string) => (await fixture.rows(analytics, dataset)).sort((a, b) => (a.id < b.id ? -1 : 1))

    test('keeps the rows appended, each in its dataset', async () => {
      await analytics.append('sales', [{ id: 's1', units: 2 }, { id: 's2', units: 1 }])
      await analytics.append('visits', [{ id: 'v1', page: '/' }])

      expect(await byId('sales')).toEqual([{ id: 's1', units: 2 }, { id: 's2', units: 1 }])
      expect(await byId('visits')).toEqual([{ id: 'v1', page: '/' }])
    })

    test('never adds a row whose id is in already: a worker may run twice', async () => {
      await analytics.append('sales', [{ id: 's1', units: 2 }])
      await analytics.append('sales', [{ id: 's1', units: 2 }, { id: 's2', units: 5 }])

      expect(await byId('sales')).toEqual([{ id: 's1', units: 2 }, { id: 's2', units: 5 }])
    })

    test('a row, once in, never changes: the first one with an id stays', async () => {
      await analytics.append('sales', [{ id: 's1', units: 2 }])
      await analytics.append('sales', [{ id: 's1', units: 9 }])

      expect(await byId('sales')).toEqual([{ id: 's1', units: 2 }])
    })

    test('keeps one row of an id repeated in one append', async () => {
      await analytics.append('sales', [{ id: 's3', units: 1 }, { id: 's3', units: 4 }])

      expect(await byId('sales')).toEqual([{ id: 's3', units: 1 }])
    })
  })
}
