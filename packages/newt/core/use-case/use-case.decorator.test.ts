import { describe, expect, test } from 'bun:test'
import { ConcurrencyConflict } from '../errors/concurrency-conflict'
import type { Span } from '../observability/span'
import type { SpanAttributes } from '../observability/span-attributes'
import type { Tracer } from '../observability/tracer'
import { Invocations } from './invocations'
import { UseCase } from './use-case.decorator'

class Recorder implements Tracer {
  readonly spans: string[] = []
  readonly events: string[] = []
  readonly errors: string[] = []

  readonly attributes: SpanAttributes[] = []

  startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    this.spans.push(name)
    this.attributes.push(attributes)
    return fn({
      setError: () => this.errors.push(name),
      addEvent: event => this.events.push(`${name}:${event}`),
      end() {},
    })
  }
}

/** Stands in for a use case whose save finds a newer version `conflicts` times before it goes through. */
class Counter {
  readonly name = 'counter'
  readonly invocations: Invocations
  runs = 0

  constructor(recorder: Recorder, private conflicts: number) {
    this.invocations = new Invocations(recorder, { context: 'shop' })
  }

  @UseCase()
  async increase() {
    this.runs++
    if (this.conflicts-- > 0) throw new ConcurrencyConflict()
  }

  @UseCase({ retryOnConflict: false })
  async set() {
    this.runs++
    if (this.conflicts-- > 0) throw new ConcurrencyConflict()
  }

  @UseCase()
  async fail() {
    this.runs++
    throw new Error('boom')
  }

  @UseCase()
  async twice() {
    await this.increase()
    await this.increase()
  }
}

describe('@UseCase', () => {
  test('each call is a span, the ones it calls inside it', async () => {
    const recorder = new Recorder()
    await new Counter(recorder, 0).twice()

    expect(recorder.spans).toEqual(['counter.twice', 'counter.increase', 'counter.increase'])
  })

  test('its span says its context, module and use case', async () => {
    const recorder = new Recorder()
    await new Counter(recorder, 0).increase()

    expect(recorder.attributes).toEqual([{ context: 'shop', module: 'counter', useCase: 'counter.increase' }])
  })

  test('an error that is not a domain one marks its span', async () => {
    const recorder = new Recorder()
    await expect(new Counter(recorder, 0).fail()).rejects.toThrow('boom')

    expect(recorder.errors).toEqual(['counter.fail'])
  })
})

describe('@UseCase, by default', () => {
  test('runs again after a conflict, and notes it in its span', async () => {
    const recorder = new Recorder()
    const counter = new Counter(recorder, 2)
    await counter.increase()

    expect(counter.runs).toBe(3)
    expect(recorder.events).toEqual(['counter.increase:conflict.retry', 'counter.increase:conflict.retry'])
  })

  test('gives up after three retries', async () => {
    const counter = new Counter(new Recorder(), 10)

    await expect(counter.increase()).rejects.toBeInstanceOf(ConcurrencyConflict)
    expect(counter.runs).toBe(4)
  })

  test('never retries any other error', async () => {
    const counter = new Counter(new Recorder(), 0)

    await expect(counter.fail()).rejects.toThrow('boom')
    expect(counter.runs).toBe(1)
  })
})

describe('@UseCase with retryOnConflict: false', () => {
  test('lets the conflict through at once', async () => {
    const counter = new Counter(new Recorder(), 1)

    await expect(counter.set()).rejects.toBeInstanceOf(ConcurrencyConflict)
    expect(counter.runs).toBe(1)
  })
})
