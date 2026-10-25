import { AsyncLocalStorage } from 'node:async_hooks'
import type { Scope } from './scope'

/**
 * A value that travels with the work in progress, as the actor does: set once where
 * the work comes in (a route, a middleware, a script, a worker) and read anywhere
 * below, without passing it by hand. An application defines what it needs: the
 * workspace a request is about, its tenant…
 *
 * ```ts
 * const workspace = defineScope<{ workspaceId: string }>('workspace')
 * workspace.run({ workspaceId }, () => items.list(…))
 * workspace.current().workspaceId
 * ```
 *
 * A worker never inherits one: it runs on its own, and enters what it needs.
 */
export function defineScope<T>(name: string, options: { missing?: () => Error } = {}): Scope<T> {
  const storage = new AsyncLocalStorage<T>()
  return {
    run: (value, fn) => storage.run(value, fn),
    current: () => {
      const value = storage.getStore()
      if (value === undefined) throw options.missing?.() ?? new Error(`Nothing is in the ${name} scope here: enter it with its run`)
      return value
    },
    find: () => storage.getStore(),
  }
}
