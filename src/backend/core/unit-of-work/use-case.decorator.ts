import type { RunOptions } from './run-options'
import type { TransactionManager } from './transaction-manager'

export type UseCaseOptions = RunOptions

export function UseCase(name: string, options?: UseCaseOptions) {
  return function <This extends { readonly transactions: TransactionManager }, Args extends unknown[], Return>(
    method: (this: This, ...args: Args) => Promise<Return>,
  ) {
    return function (this: This, ...args: Args): Promise<Return> {
      return this.transactions.run(name, () => method.apply(this, args), options)
    }
  }
}
