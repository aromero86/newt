import { AsyncLocalStorage } from 'node:async_hooks'
import type { UnitOfWork } from './unit-of-work'

/** Where the unit of work in scope lives. Only the unit-of-work functions use it. */
export const unitOfWorkStorage = new AsyncLocalStorage<UnitOfWork>()
