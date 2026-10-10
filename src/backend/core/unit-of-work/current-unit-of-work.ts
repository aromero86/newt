import type { UnitOfWork } from './unit-of-work'
import { unitOfWorkStorage } from './unit-of-work-storage'

export function currentUnitOfWork(): UnitOfWork | undefined {
  return unitOfWorkStorage.getStore()
}
