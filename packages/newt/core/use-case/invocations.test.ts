import { afterEach, describe, expect, test } from 'bun:test'
import { ConcurrencyConflict } from '../errors/concurrency-conflict'
import { ConflictError } from '../errors/conflict-error'
import type { Span } from '../observability/span'
import type { SpanAttributes } from '../observability/span-attributes'
import type { Tracer } from '../observability/tracer'
import { invocationChain, inWorker } from './invocation-chain'
import { Invocations } from './invocations'
import { UseCase } from './use-case.decorator'

/** One line per thing a span is told, so a test reads the trace as it happened. */
class Recorder implements Tracer {
  readonly log: string[] = []

  startActiveSpan<T>(name: string, _attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    return fn({
      setError: () => void this.log.push(`${name} error`),
      addEvent: (event, attributes) => void this.log.push(`${name} ${event} ${JSON.stringify(attributes)}`),
      end: () => void this.log.push(`${name} end`),
    })
  }
}

class Taken extends ConflictError {
  readonly code = 'taken'
}

const originalWarn = console.warn

afterEach(() => {
  console.warn = originalWarn
})

/** The warnings `console.warn` gets while `fn` runs. */
async function warningsOf(fn: () => Promise<unknown>): Promise<string[]> {
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => void warnings.push(String(args[0]))
  try {
    await fn()
  } finally {
    console.warn = originalWarn
  }
  return warnings
}

describe('a span', () => {
  test('ends whether the use case succeeds or fails', async () => {
    const recorder = new Recorder()
    const invocations = new Invocations(recorder)

    await invocations.run('thing.read', async () => 'ok')
    await invocations.run('thing.break', async () => { throw new Error('boom') }).catch(() => {})

    expect(recorder.log).toEqual(['thing.read end', 'thing.break error', 'thing.break end'])
  })

  test('a domain error is an answer, not a failure: it does not mark it', async () => {
    const recorder = new Recorder()

    await new Invocations(recorder).run('thing.take', async () => { throw new Taken('taken') }).catch(() => {})

    expect(recorder.log).toEqual(['thing.take end'])
  })

  test('each retry on a conflict is an event that says which attempt it is', async () => {
    const recorder = new Recorder()
    let conflicts = 2

    await new Invocations(recorder).run('thing.save', async () => {
      if (conflicts-- > 0) throw new ConcurrencyConflict()
    })

    expect(recorder.log).toEqual([
      'thing.save conflict.retry {"attempt":1}',
      'thing.save conflict.retry {"attempt":2}',
      'thing.save end',
    ])
  })
})

describe('the invocation chain', () => {
  test('keeps the use case the work started with, and the one running now', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' })

    const seen = await invocations.run('order.place', () =>
      invocations.run('stock.reserve', async () => invocationChain.current()), { writesTo: ['stock'] })

    expect(seen).toEqual({
      root: { context: 'shop', module: 'order', useCase: 'order.place', writesTo: ['stock'] },
      current: { context: 'shop', module: 'stock', useCase: 'stock.reserve' },
    })
  })
})

describe('checkWrite', () => {
  /** A write by `current`, reached from `root`, in the contexts given. */
  const writeFrom = (invocations: Invocations, root: string, current: string, options?: { writesTo?: string[], other?: Invocations }) =>
    invocations.run(root, () => (options?.other ?? invocations).run(current, async () => (options?.other ?? invocations).checkWrite()), { writesTo: options?.writesTo })

  test('a use case writes to its own module', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    await writeFrom(invocations, 'order.place', 'order.save')
  })

  test('to another one, it is an error when the rule says so', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    await expect(writeFrom(invocations, 'order.place', 'stock.reserve')).rejects.toThrow('order.place writes to shop.stock outside a worker')
  })

  test('to another one it lists in writesTo, it may', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    await writeFrom(invocations, 'order.place', 'stock.reserve', { writesTo: ['stock'] })
  })

  test('from a worker, it may write anywhere', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    await inWorker.run(true, () => writeFrom(invocations, 'order.place', 'stock.reserve'))
  })

  test("a use case of another context is that context's API: the root of what it does there", async () => {
    const shop = new Invocations(undefined, { context: 'shop' }, 'error')
    const billing = new Invocations(undefined, { context: 'billing' }, 'error')

    await writeFrom(shop, 'order.place', 'invoice.create', { other: billing })
    const chain = await shop.run('order.place', () => billing.run('invoice.create', async () => invocationChain.current()), { writesTo: ['stock'] })

    expect(chain?.root).toEqual({ context: 'billing', module: 'invoice', useCase: 'invoice.create', writesTo: [] })
  })

  test('inside the context called, the rule holds as for any other', async () => {
    const shop = new Invocations(undefined, { context: 'shop' }, 'error')
    const billing = new Invocations(undefined, { context: 'billing' }, 'error')

    await expect(shop.run('order.place', () => billing.run('invoice.create', () => billing.run('payment.take', async () => billing.checkWrite()))))
      .rejects.toThrow('invoice.create writes to billing.payment outside a worker')
  })

  test('off checks nothing, and outside a use case there is nothing to check', async () => {
    const warnings = await warningsOf(() => writeFrom(new Invocations(undefined, {}, 'off'), 'order.place', 'stock.reserve'))
    expect(warnings).toEqual([])
    new Invocations(undefined, {}, 'error').checkWrite()
  })

  test('is an error by default', async () => {
    await expect(writeFrom(new Invocations(undefined, { context: 'shop' }), 'order.place', 'stock.reserve')).rejects.toThrow('outside a worker')
  })

  test('warn warns, once for each pair of modules', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'warn')

    const warnings = await warningsOf(async () => {
      await writeFrom(invocations, 'order.place', 'stock.reserve')
      await writeFrom(invocations, 'order.place', 'stock.reserve')
      await writeFrom(invocations, 'order.place', 'invoice.create')
    })

    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('order.place writes to shop.stock')
    expect(warnings[1]).toContain('order.place writes to shop.invoice')
  })
})

describe('@UseCase', () => {
  test('hands the method its arguments', async () => {
    class Greeter {
      readonly name = 'greeter'
      readonly invocations = new Invocations()

      @UseCase()
      async greet(who: string, times: number) {
        return `${who} ${times}`
      }
    }

    expect(await new Greeter().greet('Ana', 2)).toBe('Ana 2')
  })
})
