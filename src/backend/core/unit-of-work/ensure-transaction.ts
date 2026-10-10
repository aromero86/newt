import { unitOfWorkStorage } from './unit-of-work-storage'

/** Opens the transaction of the unit of work in scope, once: on its first write. */
export function ensureTransaction(begin: () => void): void {
  const uow = unitOfWorkStorage.getStore()
  if (uow && !uow.opened) {
    begin()
    uow.opened = true
  }
}
