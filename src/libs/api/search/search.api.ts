import type { SearchFilterDTO, SearchPageDTO } from '../../../backend/modules/search/search.schema'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `search` module: finding things by their words and their meaning. */
export class SearchApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of what matches, best first. */
  search(workspaceId: string, filter: SearchFilterDTO, page?: PageRequest) {
    return this.get<SearchPageDTO>(`/${workspaceId}/search`, {
      ...page,
      query: filter.query,
      kind: filter.kinds?.length ? filter.kinds.join(',') : undefined,
      featureId: filter.featureId,
      appliesIn: filter.appliesIn?.length ? filter.appliesIn.map(({ dimensionId, valueId }) => `${dimensionId}:${valueId}`).join(',') : undefined,
      definition: filter.definition === 'planned' ? 'planned' : undefined,
      history: filter.history ? 'true' : undefined,
    })
  }

  /** A page of what talks about the same as an artifact in force, closest first. */
  similar(workspaceId: string, targetId: string, page?: PageRequest) {
    return this.get<SearchPageDTO>(`/${workspaceId}/search/similar`, { ...page, targetId })
  }
}
