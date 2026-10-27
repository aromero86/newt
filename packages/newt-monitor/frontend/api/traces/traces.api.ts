import type { TraceDTO, TraceListDTO, TraceListQueryDTO } from '../../../src/contexts/monitor/modules/traces/traces.schema'
import { Requester } from 'newt-react'

/** The monitor's `traces` module: an application's traces, listed and whole. */
export class TracesApi extends Requester {
  protected readonly path = '/apps'

  list(appId: string, query: TraceListQueryDTO) {
    return this.get<TraceListDTO>(`/${appId}/traces`, query)
  }

  trace(appId: string, traceId: string) {
    return this.get<TraceDTO>(`/${appId}/traces/${traceId}`)
  }
}
