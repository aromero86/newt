import { DomainError } from '../errors/domain-error'
import { NoopTracer } from '../observability/noop-tracer'
import { type Tracer } from '../observability/tracer'
import type { RunOptions } from './run-options'
import type { TransactionRunner } from './transaction-runner'
import { currentUnitOfWork } from './current-unit-of-work'
import { runInUnitOfWork } from './run-in-unit-of-work'
import { runOutsideUnitOfWork } from './run-outside-unit-of-work'
import type { UnitOfWork } from './unit-of-work'


export class TransactionManager {

  constructor(
    private readonly db: TransactionRunner,
    private readonly tracer: Tracer = new NoopTracer(),
  ) {}

  /**
   * Traces `fn` and decides how it relates to the surrounding transaction: opt out of
   * one entirely, join the caller's, or open a new one and commit it.
   */
  run<T>(name: string, fn: () => Promise<T>, options?: RunOptions): Promise<T> {
    return this.tracer.startActiveSpan(name, async span => {
      try {
        if (options?.transactional === false) {
          return await runOutsideUnitOfWork(fn)
        }
        if (currentUnitOfWork()) {
          return await fn()
        }
        return await this.inUnitOfWork(fn)
      } catch (error) {
        if (!(error instanceof DomainError)) span.setError(error)
        throw error
      } finally {
        span.end()
      }
    })
  }

  /** Owns one unit of work end to end: commit, then emit what it collected. */
  private async inUnitOfWork<T>(fn: () => Promise<T>): Promise<T> {
    const uow = { events: [], opened: false } as UnitOfWork

    try {
      const result = await runInUnitOfWork(uow, fn)
      if (uow.opened) {
        this.db.exec('COMMIT')
      }
      for (const emit of uow.events) {
        emit()
      }
      return result
    } catch (error) {
      const commit = error instanceof DomainError && error.commitOnThrow
      if (uow.opened) {
        this.db.exec(commit ? 'COMMIT' : 'ROLLBACK')
      }
      if (commit) {
        for (const emit of uow.events) {
          emit()
        }
      }
      throw error
    }
  }

}
