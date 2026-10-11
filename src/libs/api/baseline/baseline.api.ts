import type { BaselinePlannedDTO } from '../../../backend/modules/baseline/baseline.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `baseline` module: what the planned definition adds to the one in force, and where each artifact came from. */
export class BaselineApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of the changes accepted and not merged yet; only those on these artifacts, if given. */
  planned(workspaceId: string, targetIds?: string[], page?: PageRequest) {
    return this.get<Page<BaselinePlannedDTO>>(`/${workspaceId}/baseline/planned`, { ...page, targetId: targetIds?.length ? targetIds.join(',') : undefined })
  }

  /** A page of the merged changes to an artifact, oldest first: the proposals that made it what it is. */
  history(workspaceId: string, targetId: string, page?: PageRequest) {
    return this.get<Page<BaselinePlannedDTO>>(`/${workspaceId}/baseline/history`, { ...page, targetId })
  }
}
