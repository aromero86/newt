import type { ConnectionStatusDTO } from '../../../backend/contexts/monitor/modules/connection/connection.schema'
import { Requester } from 'newt-react'

/** The monitor's `connection` module: whether an application answers. */
export class ConnectionApi extends Requester {
  protected readonly path = '/apps'

  /** As the monitor last found it: `unknown` until it first asks. */
  status(appId: string) {
    return this.get<ConnectionStatusDTO>(`/${appId}/connection`)
  }

  /** Asks it now. */
  check(appId: string) {
    return this.post<ConnectionStatusDTO>(`/${appId}/connection/check`)
  }
}
