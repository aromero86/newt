import type { UnitOfWork } from './unit-of-work'
import { unitOfWorkStorage } from './unit-of-work-storage'

export function runInUnitOfWork<T>(uow: UnitOfWork, fn: () => Promise<T>): Promise<T> {
  return unitOfWorkStorage.run(uow, fn)
}
