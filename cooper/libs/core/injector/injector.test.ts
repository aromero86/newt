import { describe, expect, test } from 'bun:test'
import { inject } from './inject'
import { Injector } from './injector'

class Feature {
  disposed = false
  dispose() { this.disposed = true }
}

class Detail {
  readonly feature = inject(Feature)
}

class Loop {
  readonly other = inject(LoopBack)
}

class LoopBack {
  readonly loop = inject(Loop)
}

describe('Injector', () => {
  test('the root creates any service once', () => {
    const root = new Injector()
    expect(root.get(Feature)).toBe(root.get(Feature))
  })

  test('a child creates what it provides and asks its parent for the rest', () => {
    const root = new Injector()
    const child = new Injector(root, [Detail])

    expect(child.get(Feature)).toBe(root.get(Feature))
    expect(child.get(Detail)).not.toBe(new Injector(root, [Detail]).get(Detail))
  })

  test('a provided service injects the services above it', () => {
    const root = new Injector()
    const child = new Injector(root, [Detail])

    expect(child.get(Detail).feature).toBe(root.get(Feature))
  })

  test('two siblings get their own instance of the same service', () => {
    const root = new Injector()
    expect(new Injector(root, [Feature]).get(Feature)).not.toBe(new Injector(root, [Feature]).get(Feature))
  })

  test('a cycle fails instead of looping', () => {
    expect(() => new Injector().get(Loop)).toThrow('Circular dependency')
  })

  test('dispose releases what the injector created, and only that', () => {
    const root = new Injector()
    const child = new Injector(root, [Feature])
    const own = child.get(Feature)
    const shared = root.get(Feature)

    child.dispose()

    expect(own.disposed).toBe(true)
    expect(shared.disposed).toBe(false)
  })
})
