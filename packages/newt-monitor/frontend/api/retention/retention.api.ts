import type { RetentionChangeDTO, RetentionDTO } from '../../../src/contexts/monitor/modules/retention/retention.schema'
import { Requester } from 'newt-react'

/** The monitor's `retention` module: how long an application's metrics are kept. */
export class RetentionApi extends Requester {
  protected readonly path = '/apps'

  retention(appId: string) {
    return this.get<RetentionDTO>(`/${appId}/retention`)
  }

  change(appId: string, input: RetentionChangeDTO) {
    return this.patch<RetentionDTO>(`/${appId}/retention`, input)
  }
}
