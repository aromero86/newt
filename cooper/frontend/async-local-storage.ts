/**
 * `node:async_hooks` for the browser, as far as newt needs it to load. The backend's
 * contracts (`*.schema.ts`) the API clients share import `newt/core` for its value
 * objects and filters, and loading `newt/core` defines its scopes (the actor's), which
 * keep their value in an `AsyncLocalStorage`. A frontend never runs a use case, so
 * nothing is ever kept in one: this stand-in only lets the module load. The build
 * leaves it out anyway (newt has no side effects); Vite's dev server does not.
 */
export class AsyncLocalStorage<T> {

  private value: T | undefined

  run<R>(value: T, fn: () => R): R {
    const before = this.value
    this.value = value
    try {
      return fn()
    } finally {
      this.value = before
    }
  }

  getStore(): T | undefined {
    return this.value
  }
}
