import { ConcurrencyConflict } from '../errors/concurrency-conflict'
import { DomainError } from '../errors/domain-error'
import { NoopTracer } from '../observability/noop-tracer'
import type { SpanAttributes } from '../observability/span-attributes'
import type { Tracer } from '../observability/tracer'
import { invocationChain, inWorker } from './invocation-chain'
import type { UseCaseOptions } from './use-case-options'
import type { WriteRule } from './write-rule'

/** How many more times a `retryOnConflict` use case runs after a conflict. */
const RETRIES = 3

/**
 * Every call to a use case: an invocation, one span of the trace it is part of. A
 * use case called by another is a span inside its caller's. An invocation holds no
 * transaction: each save is one of its own.
 *
 * Each span says what it is: its use case (`product.update`), its module (`product`)
 * and whatever the context added (its name).
 */
export class Invocations {

  private readonly warned = new Set<string>()

  constructor(
    private readonly tracer: Tracer = new NoopTracer(),
    private readonly attributes: SpanAttributes = {},
    private readonly writeRule: WriteRule = 'warn',
  ) {}

  run<T>(name: string, fn: () => Promise<T>, options?: UseCaseOptions): Promise<T> {
    const module = name.split('.')[0]!
    const attributes = { ...this.attributes, module, useCase: name }
    const link = { context: String(this.attributes.context ?? ''), module, useCase: name }
    const chain = invocationChain.find()
    return invocationChain.run({ root: chain?.root ?? { ...link, writesTo: options?.writesTo ?? [] }, current: link }, () => this.traced(name, attributes, fn, options))
  }

  /**
   * Called before a save: a use case writes to its own module, or to another one
   * only from a worker (where a failure halfway is retried until it completes) or
   * when its root use case says so (`writesTo`).
   */
  checkWrite(): void {
    const chain = invocationChain.find()
    if (this.writeRule === 'off' || !chain || inWorker.find()) return
    const { root, current } = chain
    if ((root.context === current.context && root.module === current.module) || root.writesTo.includes(current.module)) return
    const message = `${root.useCase} writes to ${current.context ? `${current.context}.` : ''}${current.module} outside a worker: write it from a worker reacting to an event, or list it in its writesTo`
    if (this.writeRule === 'error') throw new Error(message)
    const pair = `${root.useCase}>${current.context}.${current.module}`
    if (this.warned.has(pair)) return
    this.warned.add(pair)
    console.warn(`[write rule] ${message}`)
  }

  private traced<T>(name: string, attributes: SpanAttributes, fn: () => Promise<T>, options?: UseCaseOptions): Promise<T> {
    return this.tracer.startActiveSpan(name, attributes, async span => {
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            return await fn()
          } catch (error) {
            if (!options?.retryOnConflict || !(error instanceof ConcurrencyConflict) || attempt === RETRIES) throw error
            span.addEvent('conflict.retry', { attempt: attempt + 1 })
            await Bun.sleep(Math.random() * 10 * (attempt + 1))
          }
        }
      } catch (error) {
        if (!(error instanceof DomainError)) span.setError(error)
        throw error
      } finally {
        span.end()
      }
    })
  }
}
