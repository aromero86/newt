import { DomainError } from '../errors/domain-error'
import { NoopTracer } from '../observability/noop-tracer'
import { type Tracer } from '../observability/tracer'
import type { RunOptions } from './run-options'
import type { TransactionRunner } from './transaction-runner'
import { currentUnitOfWork } from './current-unit-of-work'
import { runInUnitOfWork } from './run-in-unit-of-work'
import { runOutsideUnitOfWork } from './run-outside-unit-of-work'
import { Turn } from './turn'
import type { UnitOfWork } from './unit-of-work'


export class TransactionManager {

  private readonly turn = new Turn()

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

  /**
   * Owns one unit of work end to end: waits for its turn, commits, then emits what
   * it collected. It emits after giving the turn back, so whatever the events start
   * waits for its own turn instead of running inside this one.
   */
  private async inUnitOfWork<T>(fn: () => Promise<T>): Promise<T> {
    const uow = { events: [], opened: false } as UnitOfWork

    const outcome = await this.turn.take(async () => {
      try {
        const result = await runInUnitOfWork(uow, fn)
        if (uow.opened) {
          this.db.exec('COMMIT')
        }
        return { ok: true as const, result }
      } catch (error) {
        const commit = error instanceof DomainError && error.commitOnThrow
        if (uow.opened) {
          this.db.exec(commit ? 'COMMIT' : 'ROLLBACK')
        }
        return { ok: false as const, error, emit: commit }
      }
    })

    if (outcome.ok || outcome.emit) {
      for (const emit of uow.events) {
        emit()
      }
    }
    if (!outcome.ok) throw outcome.error
    return outcome.result
  }

}
