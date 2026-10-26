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
      retry: { allowed: true },
    })
  })
})

describe('on a conflict', () => {
  test('only the first use case of a chain runs again, with all it calls', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' })
    let inner = 0

    await invocations.run('order.place', () => invocations.run('stock.reserve', async () => {
      inner++
      throw new ConcurrencyConflict()
    })).catch(() => {})

    expect(inner).toBe(4)
  })

  test('one that must not run twice keeps the ones above it from running it again', async () => {
    const shop = new Invocations(undefined, { context: 'shop' })
    const billing = new Invocations(undefined, { context: 'billing' })
    let invoices = 0
    let orders = 0

    // invoice.create says it must not run twice; order.place, which calls it, does not
    // know, and checkout.run, of another context, calls that.
    const place = () => shop.run('order.place', async () => {
      await billing.run('invoice.create', async () => { invoices++ }, { retryOnConflict: false })
      if (orders++ === 0) throw new ConcurrencyConflict()
    })
    await expect(billing.run('checkout.run', place)).rejects.toBeInstanceOf(ConcurrencyConflict)

    expect([invoices, orders]).toEqual([1, 1])
  })

  test('a chain that has not reached it yet still runs again', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' })
    let runs = 0

    await invocations.run('order.place', async () => {
      if (runs++ === 0) throw new ConcurrencyConflict()
      await invocations.run('invoice.create', async () => {}, { retryOnConflict: false })
    })

    expect(runs).toBe(2)
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
    await expect(writeFrom(invocations, 'order.place', 'stock.reserve')).rejects.toThrow('[write rule] order.place writes to shop.stock outside a worker')
  })

  test('to another one it lists in writesTo, it may', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    await writeFrom(invocations, 'order.place', 'stock.reserve', { writesTo: ['stock'] })
  })

  test('a writesTo counts for what is written below it, however deep it is said', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    const write = (current: string) => invocations.run(current, async () => invocations.checkWrite())

    // onboarding.start → workspace.create (writesTo member) → member.add, which saves.
    await invocations.run('onboarding.start', () =>
      invocations.run('workspace.create', () => write('member.add'), { writesTo: ['member'] }), { writesTo: ['workspace'] })

    // Not above it: a sibling call outside workspace.create may not.
    await expect(invocations.run('onboarding.start', async () => {
      await invocations.run('workspace.create', async () => {}, { writesTo: ['member'] })
      await write('member.add')
    }, { writesTo: ['workspace'] })).rejects.toThrow('onboarding.start writes to shop.member')
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

  test('warn warns, once for each use case and module it writes to', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'warn')

    const warnings = await warningsOf(async () => {
      await writeFrom(invocations, 'order.place', 'stock.reserve')
      await writeFrom(invocations, 'order.place', 'stock.reserve')
      await writeFrom(invocations, 'order.place', 'invoice.create')
    })

    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toStartWith('[write rule] order.place writes to shop.stock')
    expect(warnings[1]).toContain('order.place writes to shop.invoice')
  })
})

describe('checkTransaction', () => {
  /** Saves by these use cases, one after another, in one transaction (`saved`), reached from `root`. */
  const saveIn = (invocations: Invocations, saved: Set<string>, root: string, current: string[], writesTo?: string[]) =>
    invocations.run(root, async () => {
      for (const each of current) await invocations.run(each, async () => invocations.checkTransaction(saved))
    }, { writesTo })

  test('a transaction saves one module, as many times as it likes, and keeps which', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    const saved = new Set<string>()

    await saveIn(invocations, saved, 'order.place', ['order.save', 'order.save'])
    expect([...saved]).toEqual(['shop.order'])
  })

  test('a second module in it is an error, in a worker too', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')

    await expect(inWorker.run(true, () => saveIn(invocations, new Set(), 'order.place', ['order.save', 'stock.reserve'])))
      .rejects.toThrow('[write rule] order.place saves shop.stock in the transaction that saved shop.order')
  })

  test('the modules its root lists in writesTo may share it, in either order', async () => {
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')

    await saveIn(invocations, new Set(), 'order.place', ['order.save', 'stock.reserve'], ['stock'])
    await saveIn(invocations, new Set(), 'order.place', ['stock.reserve', 'order.save'], ['stock'])
    await expect(saveIn(invocations, new Set(), 'order.place', ['stock.reserve', 'invoice.create'], ['stock'])).rejects.toThrow('saves shop.invoice')
  })

  test('off, outside a use case, or on a store that keeps no saves, checks nothing', async () => {
    await saveIn(new Invocations(undefined, { context: 'shop' }, 'off'), new Set(), 'order.place', ['order.save', 'stock.reserve'])
    const invocations = new Invocations(undefined, { context: 'shop' }, 'error')
    invocations.checkTransaction(new Set(['shop.order']))
    await invocations.run('stock.reserve', async () => invocations.checkTransaction(undefined))
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
