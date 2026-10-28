import type { ClosedTraces } from '../../core/traces/trace'
import type { TraceSink } from '../../core/traces/trace-sink'

/**
 * Where an application keeps the traces it recorded, by the minute they were kept in, for
 * whoever monitors it to collect: `MemoryTraces` for one instance, `RedisTraces` for
 * several. A minute is collected once it is closed, so nothing comes into it later.
 */
export interface Traces extends TraceSink {
  /** The traces of the minutes closed after `since` (all it keeps, if null), at most about `limit`: whole minutes. */
  closed(since: string | null, now: Date, limit?: number): Promise<ClosedTraces>
  close(): Promise<void>
}

/** At most how many traces a page of `closed` has: it stops at the minute that would pass it, unless it is the first. */
export const TRACES_PAGE = 2_000

/** The minutes from a page, whole: the ones before the one that would pass `limit`; at least the first. */
export function pageOf<T>(minutes: [string, T[]][], until: string, limit: number): { minutes: [string, T[]][], until: string } {
  const page: [string, T[]][] = []
  let size = 0
  for (const [minute, traces] of minutes) {
    if (page.length > 0 && size + traces.length > limit) return { minutes: page, until: page.at(-1)![0] }
    page.push([minute, traces])
    size += traces.length
  }
  return { minutes: page, until }
}
