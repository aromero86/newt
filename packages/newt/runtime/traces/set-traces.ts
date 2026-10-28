import { ratesOf, type TraceSampling } from '../../core/traces/trace-sampling'
import { applicationTraces } from '../../core/traces/trace-sink'
import { MemoryTraces } from './memory-traces'
import type { Traces } from './traces'

export type SetTracesOptions = {
  /**
   * The share of traces kept that went well and ran once, from 0 to 1: 0.01 by default;
   * or one per use case, route, queue or context (`TraceSampling`). Those that did not
   * are all kept. `NEWT_TRACE_SAMPLE_RATE`, when set, is the default share instead of
   * the one here: to change it without changing the code.
   */
  sampleRate?: TraceSampling
  /** The most log lines a trace keeps: 200 by default. Those past it are counted. */
  maxLogs?: number
}

/**
 * Where the application keeps its traces: `RedisTraces` when several instances share
 * the work, so the monitor collects them all from one. Set once, where the
 * application starts. Unset, they are kept in its memory, once its monitor endpoint
 * serves: nothing is traced before.
 */
export function setTraces(traces: Traces, options: SetTracesOptions = {}): void {
  const sampleRate = withDefault(options.sampleRate ?? 0.01, process.env.NEWT_TRACE_SAMPLE_RATE)
  const wrong = ratesOf(sampleRate).find(rate => !(rate >= 0 && rate <= 1))
  if (wrong !== undefined) throw new Error(`A sample rate is a share, from 0 to 1, not ${wrong}`)
  const maxLogs = options.maxLogs ?? 200
  if (!Number.isInteger(maxLogs) || maxLogs < 0) throw new Error(`The most log lines a trace keeps is a whole number, not ${maxLogs}`)
  applicationTraces.sink = traces
  applicationTraces.sampleRate = sampleRate
  applicationTraces.maxLogs = maxLogs
}

/** The sampling with the environment's default share in place of its own, when there is one. */
function withDefault(sampling: TraceSampling, env: string | undefined): TraceSampling {
  if (env === undefined || env.trim() === '') return sampling
  const share = Number(env)
  return typeof sampling === 'number' ? share : { ...sampling, default: share }
}

/** The application's traces, turned on: the ones set, or its memory's. What `serveMonitor` does. */
export function enableTraces(): Traces {
  if (!applicationTraces.sink) setTraces(new MemoryTraces(), { sampleRate: applicationTraces.sampleRate, maxLogs: applicationTraces.maxLogs })
  applicationTraces.enabled = true
  return applicationTraces.sink as Traces
}
