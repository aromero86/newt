import type { Trace } from './trace'

/** Where finished traces go, once kept: `MemoryTraces`, `RedisTraces` (`newt/runtime`). */
export interface TraceSink {
  record(trace: Trace): void
}

/**
 * The application's traces, if it records any: none until its monitor endpoint serves
 * (`serveMonitor` turns them on), so an application nobody watches traces nothing.
 * `sampleRate` is the share of traces kept that went well and ran once.
 */
export const applicationTraces: { sink: TraceSink | null, sampleRate: number, enabled: boolean } = {
  sink: null,
  sampleRate: 0.01,
  enabled: false,
}
