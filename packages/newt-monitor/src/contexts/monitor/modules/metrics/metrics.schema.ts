import { z } from 'zod'

/** The fewest days the minute detail is kept: the daily summary is made of days at least two days old. */
export const MIN_MINUTE_DAYS = 3

/**
 * What the monitor collects of an application's metrics: up to which minute it has
 * them, and how long it keeps them.
 */
export const MetricsFeedSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** The last minute collected: the next collection asks from it. Null before the first. */
  until: z.iso.datetime().nullable().default(null),
  /** How many days each minute is kept, with its actor: 30 by default. */
  minuteDays: z.number().int().min(MIN_MINUTE_DAYS).max(3650).default(30),
  /** How many days each day's summary, without actor, is kept: null for ever. */
  dayDays: z.number().int().min(MIN_MINUTE_DAYS).max(36500).nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** How long an application's metrics are kept, as a client changes it. */
export const MetricsRetentionSchema = MetricsFeedSchema.pick({ minuteDays: true, dayDays: true }).partial()
  .refine(change => change.minuteDays !== undefined || change.dayDays !== undefined, 'Say what changes: minuteDays or dayDays')

export type MetricsFeedDTO = z.infer<typeof MetricsFeedSchema>
export type MetricsRetentionDTO = Pick<MetricsFeedDTO, 'minuteDays' | 'dayDays'>
export type MetricsRetentionChangeDTO = z.input<typeof MetricsRetentionSchema>

/** What one collection came to: how many counts, up to which minute; or why nothing. */
export type CollectDTO =
  | { appId: string, outcome: 'collected', counts: number, until: string }
  | { appId: string, outcome: 'unreachable' | 'archived' | 'gone' }

/** The windows a panel shows, and the buckets each one may be drawn in: not configurable. */
export const WINDOWS = {
  '1h': { ms: 60 * 60_000, buckets: ['1m', '5m'] },
  '24h': { ms: 24 * 60 * 60_000, buckets: ['1m', '5m', '15m', '1h'] },
  '7d': { ms: 7 * 24 * 60 * 60_000, buckets: ['15m', '1h', '1d'] },
  '30d': { ms: 30 * 24 * 60 * 60_000, buckets: ['1h', '1d'] },
  '90d': { ms: 90 * 24 * 60 * 60_000, buckets: ['1d'] },
  '365d': { ms: 365 * 24 * 60 * 60_000, buckets: ['1d'] },
} as const

/** The bucket a window is drawn in unless told. */
export const DEFAULT_BUCKET = { '1h': '1m', '24h': '15m', '7d': '1h', '30d': '1d', '90d': '1d', '365d': '1d' } as const

export const BUCKETS = { '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000, '1d': 24 * 60 * 60_000 } as const

export type MetricsWindow = keyof typeof WINDOWS
export type MetricsBucket = keyof typeof BUCKETS

/** A scope to filter by: `workspace:01a1…`, its name and its value's id. */
const ScopeFilterSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_ ]*:.+$/, 'A scope is <name>:<id>')

/** What a client asks of an event's series. */
export const SeriesQuerySchema = z.object({
  context: z.string().min(1),
  event: z.string().min(1),
  window: z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h'),
  bucket: z.enum(Object.keys(BUCKETS) as [MetricsBucket, ...MetricsBucket[]]).optional(),
  /** Beside it, the same length just before (`previous`), or a week before (`week`). */
  compare: z.enum(['previous', 'week', 'none']).default('previous'),
  scope: ScopeFilterSchema.optional(),
  actor: z.string().min(1).optional(),
}).refine(query => query.bucket === undefined || (WINDOWS[query.window].buckets as readonly string[]).includes(query.bucket), {
  message: 'That bucket is not one of its window\'s', path: ['bucket'],
})

/** What a client asks of the events' totals, or of who tells one most. */
export const TotalsQuerySchema = z.object({
  window: z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h'),
})

export const TopQuerySchema = z.object({
  context: z.string().min(1),
  event: z.string().min(1),
  window: z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h'),
  /** `actor`, or `scope:<name>`. */
  by: z.string().regex(/^(actor|scope:[A-Za-z_][A-Za-z0-9_ ]*)$/, 'By actor, or scope:<name>'),
})

export type SeriesQueryDTO = z.input<typeof SeriesQuerySchema>
export type TopQueryDTO = z.input<typeof TopQuerySchema>

/** One bucket of a series: when it starts, and how many. */
export type SeriesPointDTO = { at: string, count: number }

/** An event's series in a window, and the one it is compared with, drawn at its buckets' times. */
export type SeriesDTO = {
  window: MetricsWindow
  bucket: MetricsBucket
  from: string
  to: string
  points: SeriesPointDTO[]
  total: number
  /** The same buckets in the window it is compared with, each at the time of the bucket it stands beside. */
  compared: SeriesPointDTO[] | null
  comparedTotal: number | null
}

/** Each event's total in a window, and in the window before it. */
export type EventTotalDTO = { context: string, event: string, total: number, previous: number }

/** Who told an event most in a window: an actor, or a scope's id. */
export type TopDTO = { value: string | null, count: number }
