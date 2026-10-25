import { describe, expect, test } from 'bun:test'
import { NoopTracer } from './noop-tracer'

describe('NoopTracer', () => {
  test('runs the work and returns what it returns', async () => {
    expect(await new NoopTracer().startActiveSpan('thing.do', {}, async () => 42)).toBe(42)
  })
})
