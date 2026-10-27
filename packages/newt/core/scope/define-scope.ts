import { AsyncLocalStorage } from 'node:async_hooks'
import { registerScope } from './registered-scopes'
import type { Scope } from './scope'

export type DefineScopeOptions = {
  /** The error `current` throws outside the scope. */
  missing?: () => Error
  /** Whether the application's metrics say which value of it an event was told in: yes, unless it is newt's own. */
  counted?: boolean
}

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
 * A worker never inherits one: it runs on its own, and enters what it needs. Its name
 * is how the application's metrics say which scope an event was told in.
 */
export function defineScope<T>(name: string, options: DefineScopeOptions = {}): Scope<T> {
  const storage = new AsyncLocalStorage<T>()
  if (options.counted !== false) registerScope(name, () => storage.getStore())
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
