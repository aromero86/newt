import { z } from 'zod'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../event-metrics/event-metrics.schema'

/** What the monitor has collected of an application's queue flows: up to which minute. */
export const QueueMetricsFeedSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** The last minute collected: the next collection asks from it. Null before the first. */
  until: z.iso.datetime().nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type QueueMetricsFeedDTO = z.infer<typeof QueueMetricsFeedSchema>

/** What one collection came to: how many flows, up to which minute; or why nothing. */
export type CollectFlowsDTO =
  | { appId: string, outcome: 'collected', flows: number, until: string }
  | { appId: string, outcome: 'unreachable' | 'archived' | 'gone' }

const windowSchema = z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h')

/** What a client asks of a queue's flow over time. */
export const QueueSeriesQuerySchema = z.object({
  context: z.string().min(1),
  queue: z.string().min(1),
  window: windowSchema,
  bucket: z.enum(Object.keys(BUCKETS) as [MetricsBucket, ...MetricsBucket[]]).optional(),
  compare: z.enum(['previous', 'week', 'none']).default('previous'),
}).refine(query => query.bucket === undefined || (WINDOWS[query.window].buckets as readonly string[]).includes(query.bucket), {
  message: 'That bucket is not one of its window\'s', path: ['bucket'],
})

export const QueueTotalsQuerySchema = z.object({ window: windowSchema })

export type QueueSeriesQueryDTO = z.input<typeof QueueSeriesQuerySchema>

/**
 * How a queue's jobs went: how many were published, delivered, redelivered and dead,
 * and how long they waited in it, by percentile (ms; null with none taken).
 */
export type FlowDTO = {
  published: number
  delivered: number
  redelivered: number
  dead: number
  waitP50: number | null
  waitP90: number | null
  waitP99: number | null
}

export type FlowPointDTO = FlowDTO & { at: string }

export type QueueSeriesDTO = {
  window: MetricsWindow
  bucket: MetricsBucket
  from: string
  to: string
  points: FlowPointDTO[]
  total: FlowDTO
  compared: FlowPointDTO[] | null
  comparedTotal: FlowDTO | null
}

/** Each queue's flow in a window, and in the window before. */
export type QueueTotalDTO = { context: string, queue: string, now: FlowDTO, previous: FlowDTO }
