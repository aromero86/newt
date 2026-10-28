import type { Trace } from './trace'
import type { TraceSampling } from './trace-sampling'

/**
 * Where finished traces go: `MemoryTraces`, `RedisTraces` (`newt/runtime`). `wanted` says
 * whether the trace is kept on its own (it went wrong, ran again, or fell in the share);
 * one that is not may still be, with the chain of traces its events make.
 */
export interface TraceSink {
  finished(trace: Trace, wanted: boolean): void
}

/**
 * The application's traces, if it records any: none until its monitor endpoint serves
 * (`serveMonitor` turns them on), so an application nobody watches traces nothing.
 * `sampleRate` is the share of traces kept that went well and ran once. `forcing` says
 * whether a request's `x-newt-trace` header was signed by who may ask for its trace:
 * what `serveMonitor` sets, with its key. `maxLogs`, the most log lines a trace keeps.
 */
export const applicationTraces: { sink: TraceSink | null, sampleRate: TraceSampling, enabled: boolean, forcing: ((header: string) => boolean) | null, maxLogs: number } = {
  sink: null,
  sampleRate: 0.01,
  enabled: false,
  forcing: null,
  maxLogs: 200,
}
