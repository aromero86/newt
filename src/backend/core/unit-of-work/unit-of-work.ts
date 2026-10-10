import { AsyncLocalStorage } from 'node:async_hooks'

export type UnitOfWork = {
  readonly events: Array<() => void>
  opened: boolean
}

const storage = new AsyncLocalStorage<UnitOfWork>()

export function currentUnitOfWork(): UnitOfWork | undefined {
  return storage.getStore()
}

export function runInUnitOfWork<T>(uow: UnitOfWork, fn: () => Promise<T>): Promise<T> {
  return storage.run(uow, fn)
}

/**
 * Runs `fn` with no unit of work in scope, even when the caller has one. Nested use
 * cases then open and commit their own transaction instead of joining the caller's.
 */
export function runOutsideUnitOfWork<T>(fn: () => Promise<T>): Promise<T> {
  return storage.exit(fn)
}

export function deferEmit(emit: () => void): void {
  const uow = storage.getStore()
  if (uow) {
    uow.events.push(emit)
  }
  else {
    emit()
  }
}

export function ensureTransaction(begin: () => void): void {
  const uow = storage.getStore()
  if (uow && !uow.opened) {
    begin()
    uow.opened = true
  }
}
