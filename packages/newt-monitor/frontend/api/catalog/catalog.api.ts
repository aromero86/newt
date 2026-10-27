import type { Page } from 'newt/contract'
import type { CatalogFilterDTO, CatalogItemDTO } from '../../../src/contexts/monitor/modules/catalog/catalog.schema'
import { type PageRequest, Requester } from 'newt-react'

/** The monitor's `catalog` module: every part an application ever had, and when. */
export class CatalogApi extends Requester {
  protected readonly path = '/apps'

  /** By kind, context and module; those there now unless `status` says otherwise. */
  list(appId: string, filter: CatalogFilterDTO = {}, page?: PageRequest) {
    return this.get<Page<CatalogItemDTO>>(`/${appId}/catalog`, { ...filter, ...page })
  }

  item(appId: string, id: string) {
    return this.get<CatalogItemDTO>(`/${appId}/catalog/${id}`)
  }
}
