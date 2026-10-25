import type { Invocations } from './invocations'
import type { UseCaseOptions } from './use-case-options'

/**
 * Makes a method one of its module's use cases, named after both: `list` of the
 * module `brand` is `brand.list`. Each call is an invocation: a span of its trace,
 * and run again on a conflict when `retryOnConflict` says so.
 */
export function UseCase(options?: UseCaseOptions) {
  return function <This extends { readonly name: string, readonly invocations: Invocations }, Args extends unknown[], Return>(
    method: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
  ) {
    const useCase = String(context.name)
    return function (this: This, ...args: Args): Promise<Return> {
      return this.invocations.run(`${this.name}.${useCase}`, () => method.apply(this, args), options)
    }
  }
}
