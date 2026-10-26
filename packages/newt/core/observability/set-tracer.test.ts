import { afterEach, describe, expect, test } from 'bun:test'
import { Invocations } from '../use-case/invocations'
import { NoopTracer } from './noop-tracer'
import { setTracer } from './set-tracer'
import type { Tracer } from './tracer'

/** A tracer that notes each span it starts, as `<context> <name>`. */
function recorder(names: string[]): Tracer {
  return {
    startActiveSpan: (name, attributes, fn) => {
      names.push(`${attributes.context} ${name}`)
      return fn({ setError() {}, addEvent() {}, end() {} })
    },
  }
}

afterEach(() => setTracer(new NoopTracer()))

describe('setTracer', () => {
  test('watches every context with no tracer of its own, even one made before it is set', async () => {
    const auth = new Invocations(undefined, { context: 'auth' })
    const boards = new Invocations(undefined, { context: 'boards' })
    const names: string[] = []
    setTracer(recorder(names))

    await boards.run('card.create', () => auth.run('access.check', async () => true))
    expect(names).toEqual(['boards card.create', 'auth access.check'])
  })

  test('a context\'s own tracer goes before it', async () => {
    const own: string[] = []
    const application: string[] = []
    setTracer(recorder(application))

    await new Invocations(recorder(own), { context: 'shop' }).run('order.place', async () => {})
    expect(own).toEqual(['shop order.place'])
    expect(application).toEqual([])
  })
})
