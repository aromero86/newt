/** A value that follows the code from where it is set: see `defineScope`. */
export type Scope<T> = {
  /** Runs `fn` with `value` in the scope, down to everything it calls, across `await`s. */
  run<R>(value: T, fn: () => R): R
  /** The value in the scope; throws when there is none. */
  current(): T
  /** The value in the scope, if there is one. */
  find(): T | undefined
}
