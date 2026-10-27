import { z } from 'zod'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../event-metrics/event-metrics.schema'

/** What the monitor has collected of an application's use case timings: up to which minute. */
export const UseCaseMetricsFeedSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** The last minute collected: the next collection asks from it. Null before the first. */
  until: z.iso.datetime().nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type UseCaseMetricsFeedDTO = z.infer<typeof UseCaseMetricsFeedSchema>

/** What one collection came to: how many timings, up to which minute; or why nothing. */
export type CollectTimingsDTO =
  | { appId: string, outcome: 'collected', timings: number, until: string }
  | { appId: string, outcome: 'unreachable' | 'archived' | 'gone' }

const windowSchema = z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h')

/** What a client asks of a use case's series. */
export const UseCaseSeriesQuerySchema = z.object({
  context: z.string().min(1),
  useCase: z.string().min(1),
  window: windowSchema,
  bucket: z.enum(Object.keys(BUCKETS) as [MetricsBucket, ...MetricsBucket[]]).optional(),
  /** Beside it, the same length just before (`previous`), or a week before (`week`). */
  compare: z.enum(['previous', 'week', 'none']).default('previous'),
  scope: z.string().regex(/^[A-Za-z_][A-Za-z0-9_ ]*:.+$/, 'A scope is <name>:<id>').optional(),
  actor: z.string().min(1).optional(),
}).refine(query => query.bucket === undefined || (WINDOWS[query.window].buckets as readonly string[]).includes(query.bucket), {
  message: 'That bucket is not one of its window\'s', path: ['bucket'],
})

export const UseCaseTotalsQuerySchema = z.object({ window: windowSchema })

export const UseCaseTopQuerySchema = z.object({
  context: z.string().min(1),
  useCase: z.string().min(1),
  window: windowSchema,
  /** `actor`, or `scope:<name>`. */
  by: z.string().regex(/^(actor|scope:[A-Za-z_][A-Za-z0-9_ ]*)$/, 'By actor, or scope:<name>'),
})

export type UseCaseSeriesQueryDTO = z.input<typeof UseCaseSeriesQuerySchema>
export type UseCaseTopQueryDTO = z.input<typeof UseCaseTopQuerySchema>

/** How a set of calls went: how many, how many runs more, and how long, on average and by percentile (ms); null with no call. */
export type LatencyDTO = {
  calls: number
  retries: number
  meanMs: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  p99: number | null
}

/** One bucket of a series: when it starts, and how its calls went. */
export type LatencyPointDTO = LatencyDTO & { at: string }

export type UseCaseSeriesDTO = {
  window: MetricsWindow
  bucket: MetricsBucket
  from: string
  to: string
  points: LatencyPointDTO[]
  total: LatencyDTO
  /** The same buckets in the window it is compared with, each at the time of the bucket it stands beside. */
  compared: LatencyPointDTO[] | null
  comparedTotal: LatencyDTO | null
}

/** Each use case's calls in a window, and in the window before. */
export type UseCaseTotalDTO = { context: string, useCase: string, now: LatencyDTO, previous: LatencyDTO }

/** Who calls a use case most in a window, an actor or a scope's id, and how their calls went. */
export type UseCaseTopDTO = { value: string | null } & LatencyDTO
