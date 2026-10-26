import { describe, expect, test } from 'bun:test'
import { ConsoleTracer } from './console-tracer'

describe('ConsoleTracer', () => {
  test('writes a trace whole once it ends: each span inside the one that called it', async () => {
    const lines: string[] = []
    const tracer = new ConsoleTracer(line => lines.push(line))

    const answer = await tracer.startActiveSpan('workspace.get', { context: 'backoffice' }, async () => {
      await tracer.startActiveSpan('job.claim', {}, async () => {})
      await tracer.startActiveSpan('staff.enter', { context: 'backoffice' }, async span => {
        span.addEvent('conflict.retry', { attempt: 1 })
      })
      await tracer.startActiveSpan('broken', {}, async span => span.setError(new Error('disk full'))).catch(() => {})
      return 42
    })

    expect(answer).toBe(42)
    expect(lines.map(line => line.replace(/\d+\.\d ms/, 'n ms'))).toEqual([
      '[trace] backoffice workspace.get n ms',
      '[trace]   backoffice staff.enter n ms (conflict.retry {"attempt":1})',
      '[trace]   broken n ms (error: disk full)',
    ])
  })

  test('leaves the worker\'s own spans out', async () => {
    const lines: string[] = []
    await new ConsoleTracer(line => lines.push(line)).startActiveSpan('job.claim', {}, async () => {})
    expect(lines).toEqual([])
  })
})
