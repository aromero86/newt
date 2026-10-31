import { z } from 'zod'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../event-metrics/event-metrics.schema'

/** What the monitor has collected of an application's instances: up to which minute. */
export const InstancesFeedSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** The last minute collected: the next collection asks from it. Null before the first. */
  until: z.iso.datetime().nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type InstancesFeedDTO = z.infer<typeof InstancesFeedSchema>

/** A process of the application, as it read itself. */
export const ProcessReadingSchema = z.object({
  rssBytes: z.number(),
  heapUsedBytes: z.number(),
  /** Its processor time, as a share of one core: over 100 with more than one. */
  cpu: z.number(),
  loopMeanMs: z.number(),
  loopMaxMs: z.number(),
})

/** The server a process runs on, as it read it. */
export const ServerReadingSchema = z.object({
  name: z.string(),
  disks: z.array(z.object({ path: z.string(), totalBytes: z.number(), freeBytes: z.number() })),
  memory: z.object({ totalBytes: z.number(), freeBytes: z.number() }),
  cpu: z.object({ cores: z.number(), load: z.tuple([z.number(), z.number(), z.number()]), usage: z.number().nullable() }),
})

export type ProcessReadingDTO = z.infer<typeof ProcessReadingSchema>
export type ServerReadingDTO = z.infer<typeof ServerReadingSchema>

export const InstanceStatusSchema = z.enum(['alive', 'stopped', 'lost'])
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>

/** An instance of an application, as it was last collected. */
export const InstanceSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** The application's id for it: a new one each time a process starts. */
  instanceId: z.string().min(1),
  pid: z.number().int(),
  startedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  /** As the application said it when last collected. */
  status: InstanceStatusSchema,
  stoppedAt: z.iso.datetime().nullable().default(null),
  process: ProcessReadingSchema,
  server: ServerReadingSchema,
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type InstanceRowDTO = z.infer<typeof InstanceSchema>

/** An instance, for a client: its status as it is now, told by the monitor (lost when it has not been heard of). */
export type InstanceDTO = Pick<InstanceRowDTO, 'instanceId' | 'pid' | 'startedAt' | 'lastSeenAt' | 'status' | 'stoppedAt' | 'process'> & {
  /** Its server's name. */
  server: string
}

/** A disk of a server as last read: and, if it fills, in how many days at the pace it has filled lately. */
export type DiskDTO = { path: string, totalBytes: number, freeBytes: number, fullInDays: number | null }

/** A server, as the last of its instances read it: and how many of them are alive. */
export type ServerDTO = {
  name: string
  /** When it was last read. */
  at: string
  disks: DiskDTO[]
  memory: { totalBytes: number, freeBytes: number }
  cpu: ServerReadingDTO['cpu']
  instances: { alive: number, total: number }
}

/** An application's servers and instances now: the alive first, then the newest. */
export type InstancesDTO = { servers: ServerDTO[], instances: InstanceDTO[] }

/** What one collection came to: how many instances and minutes, up to which minute; or why nothing. */
export type CollectInstancesDTO =
  | { appId: string, outcome: 'collected', instances: number, minutes: number, until: string }
  | { appId: string, outcome: 'unreachable' | 'archived' | 'gone' }

const windowSchema = z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h')
const bucketSchema = z.enum(Object.keys(BUCKETS) as [MetricsBucket, ...MetricsBucket[]]).optional()
const bucketOfItsWindow = (query: { window: MetricsWindow, bucket?: MetricsBucket }) => query.bucket === undefined || (WINDOWS[query.window].buckets as readonly string[]).includes(query.bucket)

/** What a client asks of how many instances there were over time. */
export const InstanceCountQuerySchema = z.object({ window: windowSchema, bucket: bucketSchema })
  .refine(bucketOfItsWindow, { message: 'That bucket is not one of its window\'s', path: ['bucket'] })

/** What a client asks of a server over time. */
export const ServerSeriesQuerySchema = z.object({ server: z.string().min(1), window: windowSchema, bucket: bucketSchema })
  .refine(bucketOfItsWindow, { message: 'That bucket is not one of its window\'s', path: ['bucket'] })

export type InstanceCountQueryDTO = z.input<typeof InstanceCountQuerySchema>
export type ServerSeriesQueryDTO = z.input<typeof ServerSeriesQuerySchema>

/** How many instances were alive in a bucket: at its emptiest and at its fullest; null in one with none collected. */
export type InstanceCountPointDTO = { at: string, min: number | null, max: number | null }

export type InstanceCountSeriesDTO = { window: MetricsWindow, bucket: MetricsBucket, from: string, to: string, points: InstanceCountPointDTO[] }

/**
 * A server in a bucket: its free memory at the lowest, its processors' usage on
 * average and at the highest, its load at the highest, and each disk's free space at
 * the lowest. Null where nothing was read.
 */
export type ServerPointDTO = {
  at: string
  memoryTotalBytes: number | null
  memoryFreeBytes: number | null
  cpuUsage: number | null
  cpuUsageMax: number | null
  load: number | null
  disks: Record<string, number | null>
}

export type ServerSeriesDTO = {
  server: string
  window: MetricsWindow
  bucket: MetricsBucket
  from: string
  to: string
  /** Each disk's size, by path, as last read. */
  disks: Record<string, number>
  points: ServerPointDTO[]
}
