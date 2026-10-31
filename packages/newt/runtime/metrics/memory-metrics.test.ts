import { describe, expect, test } from 'bun:test'
import { MemoryMetrics, SETTLE_MS } from './memory-metrics'

describe('MemoryMetrics', () => {
  test('takes a minute for closed only once what was published in it has had time to commit', async () => {
    const metrics = new MemoryMetrics()
    metrics.enable()
    const at = new Date('2026-01-01T10:00:30Z')
    metrics.count({ context: 'shop', event: 'order.placed', scopes: {}, actor: null, at })
    metrics.time({ context: 'shop', useCase: 'placeOrder', scopes: {}, actor: null, at, ms: 3, retries: 0 })
    metrics.flow({ context: 'shop', queue: 'mail', kind: 'published', at })

    const justAfter = new Date(Date.parse('2026-01-01T10:01:00Z') + 1)
    expect(await metrics.closed(null, justAfter)).toEqual({ counts: [], until: '2026-01-01T09:59:00.000Z' })
    expect((await metrics.closedTimings(null, justAfter)).timings).toEqual([])
    expect((await metrics.closedFlows(null, justAfter)).flows).toEqual([])
    expect((await metrics.instances(null, justAfter)).until).toBe('2026-01-01T09:59:00.000Z')

    const settled = new Date(Date.parse('2026-01-01T10:01:00Z') + SETTLE_MS)
    expect(await metrics.closed(null, settled)).toEqual({
      counts: [{ minute: '2026-01-01T10:00:00.000Z', context: 'shop', event: 'order.placed', scopes: {}, actor: null, count: 1 }],
      until: '2026-01-01T10:00:00.000Z',
    })
    expect((await metrics.closedTimings(null, settled)).timings).toHaveLength(1)
    expect((await metrics.closedFlows(null, settled)).flows).toHaveLength(1)
    expect((await metrics.instances(null, settled)).until).toBe('2026-01-01T10:00:00.000Z')
  })
})
