import type { Trace } from './trace'

/**
 * The share of traces kept that went well and ran once, from 0 to 1: one for every
 * trace, or one for each use case, route, queue or context named, and the `default` for
 * the rest. The most concrete one a trace matches says: its use cases (the highest of
 * theirs), then its route or its queue, then its contexts, then the default.
 *
 * ```ts
 * { default: 0.01, useCases: { 'payment.charge': 1 }, routes: { 'GET /api/health': 0 } }
 * ```
 */
export type TraceSampling = number | SamplingRules

export type SamplingRules = {
  default: number
  /** By use case: `card.create`. */
  useCases?: Record<string, number>
  /** By route, as the router names it: `POST /api/cards/:id`. */
  routes?: Record<string, number>
  /** By queue, for its jobs: `card.index.on.card.created`. */
  queues?: Record<string, number>
  /** By context, for the calls in it. */
  contexts?: Record<string, number>
}

/** The share a trace is kept in, by the most concrete rule it matches. */
export function rateOf(trace: Trace, sampling: TraceSampling): number {
  if (typeof sampling === 'number') return sampling
  const highest = (rates: Record<string, number> | undefined, names: string[]) => {
    const found = names.map(name => rates?.[name]).filter(rate => rate !== undefined)
    return found.length ? Math.max(...found) : undefined
  }
  const contexts = [...new Set(trace.spans.filter(span => span.kind === 'use-case' && span.context).map(span => span.context!))]
  return highest(sampling.useCases, trace.useCases)
    ?? (trace.kind === 'http' ? sampling.routes?.[trace.name] : sampling.queues?.[trace.name])
    ?? highest(sampling.contexts, contexts)
    ?? sampling.default
}

/** Every share a sampling names, each from 0 to 1: what is checked as it is set. */
export function ratesOf(sampling: TraceSampling): number[] {
  if (typeof sampling === 'number') return [sampling]
  return [sampling.default, ...[sampling.useCases, sampling.routes, sampling.queues, sampling.contexts].flatMap(rates => Object.values(rates ?? {}))]
}

/**
 * Whether a finished trace is kept: always when something asked for it (`keepTrace`, a
 * signed header), when something in it went wrong (an error, a failure) or ran again (a
 * conflict, a job's run after the first); otherwise, its share of them, at random.
 */
export function keeps(trace: Trace, sampling: TraceSampling, random = Math.random): boolean {
  if (trace.forced || trace.outcome || trace.retried || trace.spans.some(span => span.outcome)) return true
  return random() < rateOf(trace, sampling)
}
