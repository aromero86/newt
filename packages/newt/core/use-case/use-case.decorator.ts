import type { Invocations } from './invocations'
import type { UseCaseOptions } from './use-case-options'

/**
 * Makes a method one of its module's use cases, named after both: `list` of the
 * module `brand` is `brand.list`. Each call is an invocation: a span of its trace,
 * run again on a conflict unless `retryOnConflict: false` says not to. Each instance of
 * its module registers it in its context's registry as it is built.
 */
export function UseCase(options?: UseCaseOptions) {
  return function <This extends { readonly name: string, readonly invocations: Invocations }, Args extends unknown[], Return>(
    method: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
  ) {
    const useCase = String(context.name)
    // Runs once `super` has returned, so a module has its name and invocations; a class
    // that sets its invocations later, in its own constructor, registers none.
    context.addInitializer(function (this: This) {
      this.invocations?.registry?.useCase(this, useCase, options)
    })
    return function (this: This, ...args: Args): Promise<Return> {
      return this.invocations.run(`${this.name}.${useCase}`, () => method.apply(this, args), options)
    }
  }
}
