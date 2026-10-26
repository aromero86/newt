import { describe, expect, test } from 'bun:test'
import { filterSpans } from './filter-spans'
import type { Tracer } from './tracer'

describe('filterSpans', () => {
  test('hands the tracer only the spans it keeps, and runs the rest without one', async () => {
    const started: string[] = []
    const tracer: Tracer = {
      startActiveSpan: (name, _attributes, fn) => {
        started.push(name)
        return fn({ setError() {}, addEvent() {}, end() {} })
      },
    }
    const filtered = filterSpans(tracer, name => !name.startsWith('job.'))

    expect(await filtered.startActiveSpan('job.claim', {}, async span => {
      span.addEvent('nothing', {})
      return filtered.startActiveSpan('card.create', {}, async () => 'made')
    })).toBe('made')
    expect(started).toEqual(['card.create'])
  })
})
