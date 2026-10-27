import type { DeadJobs } from 'newt/contract'
import type { DepthQueryDTO, DepthSeriesDTO, OutboxNowDTO } from '../../../src/contexts/monitor/modules/outbox/outbox.schema'
import { Requester } from 'newt-react'

/** The monitor's `outbox` module: how full each queue of an application is, and its dead jobs. */
export class OutboxApi extends Requester {
  protected readonly path = '/apps'

  /** Its queues as the last snapshot found them. */
  current(appId: string) {
    return this.get<OutboxNowDTO>(`/${appId}/outbox`)
  }

  depth(appId: string, query: DepthQueryDTO) {
    return this.get<DepthSeriesDTO>(`/${appId}/outbox/depth`, query)
  }

  /** A page of a context's dead jobs, without their payloads. */
  dead(appId: string, query: { context: string, after?: string, limit?: number }) {
    return this.get<DeadJobs>(`/${appId}/outbox/dead`, query)
  }
}
