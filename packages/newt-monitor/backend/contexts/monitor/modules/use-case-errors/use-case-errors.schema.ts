import { z } from 'zod'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../event-metrics/event-metrics.schema'

/** What the monitor has collected of how an application's use case calls ended: up to which minute. */
export const UseCaseErrorsFeedSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** The last minute collected: the next collection asks from it. Null before the first. */
  until: z.iso.datetime().nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type UseCaseErrorsFeedDTO = z.infer<typeof UseCaseErrorsFeedSchema>

/** What one collection came to: how many codes counted, up to which minute; or why nothing. */
export type CollectErrorsDTO =
  | { appId: string, outcome: 'collected', counted: number, until: string }
  | { appId: string, outcome: 'unreachable' | 'archived' | 'gone' }
  | { appId: string, outcome: 'failed', message: string }

const windowSchema = z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h')
const scopeSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_ ]*:.+$/, 'A scope is <name>:<id>')

/** What a client asks of a use case's errors over time. */
/** Of one use case, or of every one of the application (neither `context` nor `useCase`). */
export const ErrorsSeriesQuerySchema = z.object({
  context: z.string().min(1).optional(),
  useCase: z.string().min(1).optional(),
  window: windowSchema,
  bucket: z.enum(Object.keys(BUCKETS) as [MetricsBucket, ...MetricsBucket[]]).optional(),
  scope: scopeSchema.optional(),
  actor: z.string().min(1).optional(),
}).refine(query => (query.context === undefined) === (query.useCase === undefined), {
  message: 'A use case is asked with its context', path: ['useCase'],
}).refine(query => query.bucket === undefined || (WINDOWS[query.window].buckets as readonly string[]).includes(query.bucket), {
  message: 'That bucket is not one of its window\'s', path: ['bucket'],
})

/** What a client asks of a use case's errors by code. */
export const ErrorCodesQuerySchema = z.object({
  context: z.string().min(1),
  useCase: z.string().min(1),
  window: windowSchema,
  scope: scopeSchema.optional(),
  actor: z.string().min(1).optional(),
})

export const ErrorsTotalsQuerySchema = z.object({ window: windowSchema })

export const ErrorsTopQuerySchema = z.object({
  context: z.string().min(1),
  useCase: z.string().min(1),
  window: windowSchema,
  /** `actor`, or `scope:<name>`. */
  by: z.string().regex(/^(actor|scope:[A-Za-z_][A-Za-z0-9_ ]*)$/, 'By actor, or scope:<name>'),
  /** Errors (expected) first, or failures (unexpected) first. */
  kind: z.enum(['error', 'failure']).default('failure'),
})

export type ErrorsSeriesQueryDTO = z.input<typeof ErrorsSeriesQuerySchema>
export type ErrorCodesQueryDTO = z.input<typeof ErrorCodesQuerySchema>
export type ErrorsTopQueryDTO = z.input<typeof ErrorsTopQuerySchema>

/** How many calls ended in an error they say may happen, and how many in a failure nobody expected. */
export type EndedDTO = { errors: number, failures: number }

export type EndedPointDTO = EndedDTO & { at: string }

export type ErrorsSeriesDTO = { window: MetricsWindow, bucket: MetricsBucket, from: string, to: string, points: EndedPointDTO[], total: EndedDTO }

/** Each use case's errors and failures in a window, and in the window before. */
export type ErrorsTotalDTO = { context: string, useCase: string, now: EndedDTO, previous: EndedDTO }

/** How many calls ended with one code, an error or a failure, in a window and in the one before. */
export type ErrorCodeDTO = { kind: 'error' | 'failure', code: string, count: number, previous: number }

/** Who ended its calls badly most: an actor, or a scope's id. */
export type ErrorsTopDTO = { value: string | null } & EndedDTO
