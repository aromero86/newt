import { unitOfWorkStorage } from './unit-of-work-storage'

/** Inside a unit of work, holds `emit` until the commit; outside one, emits at once. */
export function deferEmit(emit: () => void): void {
  const uow = unitOfWorkStorage.getStore()
  if (uow) {
    uow.events.push(emit)
  }
  else {
    emit()
  }
}
