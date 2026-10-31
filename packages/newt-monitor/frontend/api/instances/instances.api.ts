import type { InstanceCountQueryDTO, InstanceCountSeriesDTO, InstancesDTO, ServerSeriesDTO, ServerSeriesQueryDTO } from '../../../src/contexts/monitor/modules/instances/instances.schema'
import { Requester } from 'newt-react'

/** The monitor's `instances` module: an application's instances and the servers they run on. */
export class InstancesApi extends Requester {
  protected readonly path = '/apps'

  /** Its servers and instances now. */
  list(appId: string) {
    return this.get<InstancesDTO>(`/${appId}/instances`)
  }

  /** How many instances were alive over a window, by bucket. */
  count(appId: string, query: InstanceCountQueryDTO) {
    return this.get<InstanceCountSeriesDTO>(`/${appId}/instances/count`, query)
  }

  /** A server's memory, processors and disks over a window, by bucket. */
  server(appId: string, query: ServerSeriesQueryDTO) {
    return this.get<ServerSeriesDTO>(`/${appId}/servers/series`, query)
  }
}
