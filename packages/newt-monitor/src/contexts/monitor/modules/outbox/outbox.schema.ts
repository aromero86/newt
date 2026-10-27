import { z } from 'zod'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../event-metrics/event-metrics.schema'

/** What one snapshot came to: how many queues, when; or why none. */
export type SnapshotDTO =
  | { appId: string, outcome: 'taken', queues: number, at: string }
  | { appId: string, outcome: 'unreachable' | 'archived' | 'gone' }

/** One queue as the last snapshot found it: how full, how long its oldest job due has waited, whether anyone serves it. */
export type OutboxQueueDTO = {
  context: string
  queue: string
  ready: number
  retrying: number
  running: number
  dead: number
  /** How long its oldest job due had waited when the snapshot was taken: null when none waited. */
  oldestWaitMs: number | null
  orphan: boolean
}

/** An application's queues as the last snapshot found them; none before the first. */
export type OutboxNowDTO = { at: string | null, queues: OutboxQueueDTO[] }

const windowSchema = z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h')

/** What a client asks of a queue's depth over time. */
export const DepthQuerySchema = z.object({
  context: z.string().min(1),
  queue: z.string().min(1),
  window: windowSchema,
  bucket: z.enum(Object.keys(BUCKETS) as [MetricsBucket, ...MetricsBucket[]]).optional(),
}).refine(query => query.bucket === undefined || (WINDOWS[query.window].buckets as readonly string[]).includes(query.bucket), {
  message: 'That bucket is not one of its window\'s', path: ['bucket'],
})

/** What a client asks of a context's dead jobs: a page, after the last one seen. */
export const DeadJobsQuerySchema = z.object({
  context: z.string().min(1),
  after: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type DepthQueryDTO = z.input<typeof DepthQuerySchema>
export type DeadJobsQueryDTO = z.input<typeof DeadJobsQuerySchema>

/** One bucket of a queue's depth: the most each kind of job reached in it; null with no snapshot. */
export type DepthPointDTO = { at: string, ready: number | null, retrying: number | null, running: number | null, dead: number | null }

export type DepthSeriesDTO = { window: MetricsWindow, bucket: MetricsBucket, from: string, to: string, points: DepthPointDTO[] }
