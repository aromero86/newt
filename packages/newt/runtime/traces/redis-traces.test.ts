import { afterEach, describe, expect, test } from 'bun:test'
import type { Trace } from '../../core/traces/trace'
import { RedisTraces } from './redis-traces'

// Against a real Redis, when there is one: REDIS_URL=redis://localhost:6390 bun test.
const url = process.env.REDIS_URL
const opened: RedisTraces[] = []
const traceOf = (id: string, told: string[] = [], eventId?: string) => ({ id, startedAt: new Date().toISOString(), ms: 3, told: told.map(each => ({ id: each, name: 'card.created', context: 'boards' })), job: eventId ? { id: `job-${id}`, queue: 'q', run: 1, event: 'card.created', eventId } : null }) as unknown as Trace

afterEach(async () => {
  await Promise.all(opened.splice(0).map(traces => traces.close()))
})

/** An instance of the application, keeping its traces in the shared Redis. */
function instance(prefix: string, maxPerMinute?: number) {
  const traces = new RedisTraces({ url: url!, prefix, maxPerMinute })
  opened.push(traces)
  return traces
}

describe.skipIf(!url)('RedisTraces', () => {
  test('gives every instance\'s traces of the minutes closed, from either', async () => {
    const prefix = `newt:test:${crypto.randomUUID()}`
    const one = instance(prefix)
    const two = instance(prefix)
    one.finished(traceOf('a'), true)
    two.finished(traceOf('b'), true)
    await Promise.all([one.close(), two.close()])
    const reader = instance(prefix)

    expect((await reader.closed(null, new Date())).traces).toEqual([])
    const later = new Date(Date.now() + 70_000)
    const closed = await reader.closed(null, later)
    expect(closed.traces.map(trace => trace.id).sort()).toEqual(['a', 'b'])
    expect((await reader.closed(closed.until, later)).traces).toEqual([])
  })

  test('a job that fails on one instance keeps the request another held', async () => {
    const prefix = `newt:test:${crypto.randomUUID()}`
    const one = instance(prefix)
    const two = instance(prefix)
    one.finished(traceOf('request', ['e1']), false)
    await one.close()
    two.finished(traceOf('failed', [], 'e1'), true)
    await two.close()

    const closed = await instance(prefix).closed(null, new Date(Date.now() + 70_000))
    expect(closed.traces.map(trace => trace.id).sort()).toEqual(['failed', 'request'])
  })

  test('keeps at most so many traces a minute', async () => {
    const traces = instance(`newt:test:${crypto.randomUUID()}`, 2)
    for (const id of ['a', 'b', 'c']) traces.finished(traceOf(id), true)
    await new Promise(resolve => setTimeout(resolve, 100))

    expect((await traces.closed(null, new Date(Date.now() + 70_000))).traces.map(trace => trace.id)).toEqual(['a', 'b'])
  })
})
