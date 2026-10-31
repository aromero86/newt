const DAY_MS = 24 * 60 * 60_000

/** A stretch of a range, read from the minutes or from the day summary. */
export type MetricsSpan = { table: 'minute' | 'day', start: number, end: number }

/**
 * Where a total over `[from, to)` is read: the whole days before `until` (the end of
 * the summary's newest day) from the summary, the rest from the minutes. Day rows start
 * at midnight, so the older edge is rounded to a whole day: the hours before it come
 * from the minutes while they are kept, and are missed once they are not.
 */
export function spansOf(from: number, to: number, until: number): MetricsSpan[] {
  const days = Math.ceil(from / DAY_MS) * DAY_MS
  const split = Math.min(until, to)
  if (split <= days) return [{ table: 'minute', start: from, end: to }]
  const spans: MetricsSpan[] = [{ table: 'minute', start: from, end: days }, { table: 'day', start: days, end: split }, { table: 'minute', start: split, end: to }]
  return spans.filter(span => span.end > span.start)
}
