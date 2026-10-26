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

  test('has the tracer send what it keeps, if it keeps any', async () => {
    let flushed = 0
    await filterSpans({ startActiveSpan: (_name, _attributes, fn) => fn({ setError() {}, addEvent() {}, end() {} }), flush: async () => void flushed++ }, () => true).flush!()
    await filterSpans({ startActiveSpan: (_name, _attributes, fn) => fn({ setError() {}, addEvent() {}, end() {} }) }, () => true).flush!()
    expect(flushed).toBe(1)
  })
})
