import type { Page } from 'newt/contract'
import type { RefreshDTO, StructureVersionDTO, StructureVersionSummaryDTO } from '../../../src/contexts/monitor/modules/structure/structure.schema'
import { type PageRequest, Requester } from 'newt-react'

/** The monitor's `structure` module: what an application is made of, version by version. */
export class StructureApi extends Requester {
  protected readonly path = '/apps'

  /** Its last version: a 404 `structure.not_read` until one is read. */
  latest(appId: string) {
    return this.get<StructureVersionDTO>(`/${appId}/structure`)
  }

  /** Reads it now: the button. */
  refresh(appId: string) {
    return this.post<RefreshDTO>(`/${appId}/structure/refresh`)
  }

  /** Its versions, the newest first. */
  versions(appId: string, page?: PageRequest) {
    return this.get<Page<StructureVersionSummaryDTO>>(`/${appId}/structure/versions`, page)
  }

  version(appId: string, versionId: string) {
    return this.get<StructureVersionDTO>(`/${appId}/structure/versions/${versionId}`)
  }
}
