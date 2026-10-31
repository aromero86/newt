// The contract comes from the backend module; the client is ours.
export { BUCKETS, DEFAULT_BUCKET, WINDOWS } from '../../../backend/contexts/monitor/modules/event-metrics/event-metrics.schema'
export type { EventTotalDTO, MetricsBucket, MetricsWindow, SeriesDTO, SeriesPointDTO, SeriesQueryDTO, TopDTO } from '../../../backend/contexts/monitor/modules/event-metrics/event-metrics.schema'
export type { EventCount } from 'newt/contract'
export * from './event-metrics.api'
