import { applicationTraces } from '../../core/traces/trace-sink'
import { MemoryTraces } from './memory-traces'
import type { Traces } from './traces'

export type SetTracesOptions = {
  /** The share of traces kept that went well and ran once, from 0 to 1: 0.01 by default. Those that did not are all kept. */
  sampleRate?: number
}

/**
 * Where the application keeps its traces: `RedisTraces` when several instances share
 * the work, so the monitor collects them all from one. Set once, where the
 * application starts. Unset, they are kept in its memory, once its monitor endpoint
 * serves: nothing is traced before.
 */
export function setTraces(traces: Traces, options: SetTracesOptions = {}): void {
  const sampleRate = options.sampleRate ?? 0.01
  if (!(sampleRate >= 0 && sampleRate <= 1)) throw new Error(`A sample rate is a share, from 0 to 1, not ${sampleRate}`)
  applicationTraces.sink = traces
  applicationTraces.sampleRate = sampleRate
}

/** The application's traces, turned on: the ones set, or its memory's. What `serveMonitor` does. */
export function enableTraces(): Traces {
  if (!applicationTraces.sink) applicationTraces.sink = new MemoryTraces()
  applicationTraces.enabled = true
  return applicationTraces.sink as Traces
}
