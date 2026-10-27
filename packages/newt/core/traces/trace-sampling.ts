import type { Trace } from './trace'

/**
 * Whether a finished trace is kept: always when something in it went wrong (an error,
 * a failure) or ran again (a conflict, a job's run after the first); otherwise, a share
 * of them, `sampleRate`, at random.
 */
export function keeps(trace: Trace, sampleRate: number, random = Math.random): boolean {
  if (trace.outcome || trace.retried || trace.spans.some(span => span.outcome)) return true
  return random() < sampleRate
}
