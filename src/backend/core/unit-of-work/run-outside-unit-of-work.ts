import { unitOfWorkStorage } from './unit-of-work-storage'

/**
 * Runs `fn` with no unit of work in scope, even when the caller has one. Nested use
 * cases then open and commit their own transaction instead of joining the caller's.
 */
export function runOutsideUnitOfWork<T>(fn: () => Promise<T>): Promise<T> {
  return unitOfWorkStorage.exit(fn)
}
