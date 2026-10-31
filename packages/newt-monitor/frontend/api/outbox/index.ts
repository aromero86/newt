// The contract comes from the backend module; the client is ours.
export type { DepthPointDTO, DepthSeriesDTO, OutboxNowDTO, OutboxQueueDTO } from '../../../backend/contexts/monitor/modules/outbox/outbox.schema'
export type { DeadJob, DeadJobs } from 'newt/contract'
export * from './outbox.api'
