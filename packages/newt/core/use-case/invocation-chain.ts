import { defineScope } from '../scope/define-scope'

type Link = { context: string, module: string, useCase: string }

/**
 * The use cases of the work in progress: the one it started with (`root`, with the
 * modules the use cases on the way down may write to beside its own: each one's
 * `writesTo`, added as it is called), the one running now, and whether the first
 * one may run it all again on a conflict (`retry`, shared by the whole chain: one
 * that says `retryOnConflict: false` turns it off for every one above it).
 */
export const invocationChain = defineScope<{ root: Link & { writesTo: string[] }, current: Link, retry: { allowed: boolean } }>('invocation', { counted: false })

/** Marks the work of a job: a worker may write to any module, since a failure halfway is retried; still one module per transaction. */
export const inWorker = defineScope<true>('worker', { counted: false })
