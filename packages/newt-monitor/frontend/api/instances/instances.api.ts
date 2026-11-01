import type { InstanceCountQueryDTO, InstanceCountSeriesDTO, InstancesDTO, SystemSeriesDTO, SystemSeriesQueryDTO } from '../../../backend/contexts/monitor/modules/instances/instances.schema'
import { Requester } from 'newt-kit-react'

/** The monitor's `instances` module: an application's instances and its system. */
export class InstancesApi extends Requester {
  protected readonly path = '/apps'

  /** Its system and instances now. */
  list(appId: string) {
    return this.get<InstancesDTO>(`/${appId}/instances`)
  }

  /** How many instances were alive over a window, by bucket. */
  count(appId: string, query: InstanceCountQueryDTO) {
    return this.get<InstanceCountSeriesDTO>(`/${appId}/instances/count`, query)
  }

  /** Its system over a window, by bucket: its instances added up and the machines they ran on. */
  system(appId: string, query: SystemSeriesQueryDTO) {
    return this.get<SystemSeriesDTO>(`/${appId}/system/series`, query)
  }
}
