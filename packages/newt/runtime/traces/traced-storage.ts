import { isTracing, traceSpan } from '../../core/internal'
import type { StorageAdapter } from '../../port-storage'

/** What goes out to where the files are: signing an address does not, so it is no step. */
const STEPS = new Set(['put', 'open', 'head', 'stat', 'delete'])

/**
 * A context's storage, each trip to where its files are a span of the trace in progress
 * (by what it did: never a key, which may say whose). Outside a trace, it is the adapter.
 */
export function tracedStorage<A extends StorageAdapter>(adapter: A, context: string): A {
  return new Proxy(adapter, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown
      if (typeof value !== 'function') return value
      const bound = (value as (...args: unknown[]) => unknown).bind(target)
      if (typeof key !== 'string' || !STEPS.has(key)) return bound
      return (...args: unknown[]) => (isTracing()
        ? traceSpan({ kind: 'storage', name: `storage.${key}`, context }, async () => bound(...args))
        : bound(...args))
    },
  })
}
