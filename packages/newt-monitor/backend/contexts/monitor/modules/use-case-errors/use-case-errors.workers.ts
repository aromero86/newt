import type { UseCaseErrors_Deps } from './use-case-errors.deps'
import type { UseCaseErrors_Module } from './use-case-errors.module'

/** When errors are collected and kept: every minute, every night; and forgotten: their application deleted. */
export function registerUseCaseErrorsWorkers(useCaseErrors: UseCaseErrors_Module, deps: UseCaseErrors_Deps): void {
  useCaseErrors.minutely.subscribe(() => useCaseErrors.collectAll(), {
    strategy: 'handler',
    queue: 'useCaseErrors.collectAll.on.useCaseErrors.minutely',
  })
  useCaseErrors.nightly.subscribe(() => useCaseErrors.keepAll(), {
    strategy: 'handler',
    queue: 'useCaseErrors.keepAll.on.useCaseErrors.nightly',
  })
  deps.app.events.deleted.subscribe(app => useCaseErrors.forget(app.id), {
    strategy: 'handler',
    queue: 'useCaseErrors.forget.on.app.deleted',
  })
}
