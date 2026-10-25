import { defineScope } from '../scope/define-scope'

type Link = { context: string, module: string, useCase: string }

/**
 * The use cases of the work in progress: the one it started with (`root`, with the
 * modules it may write to beside its own) and the one running now.
 */
export const invocationChain = defineScope<{ root: Link & { writesTo: string[] }, current: Link }>('invocation')

/** Marks the work of a job: a worker may write to any module, since a failure halfway is retried. */
export const inWorker = defineScope<true>('worker')
