import type { RuleDTO, RuleVersionDTO } from '../../../backend/modules/rule/rule.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** Which rules to list. Only one value per dimension: the rules that apply in all of them. */
export type RuleListFilter = {
  featureId?: string
  retired?: boolean
  appliesIn?: { dimensionId: string, valueId: string }[]
}

/** The backend's `rule` module: reading rules and their history. */
export class RuleApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of rules, in the order of their numbers. */
  list(workspaceId: string, filter: RuleListFilter = {}, page?: PageRequest) {
    return this.get<Page<RuleDTO>>(`/${workspaceId}/rules`, {
      ...page,
      featureId: filter.featureId,
      retired: filter.retired ? 'true' : undefined,
      appliesIn: filter.appliesIn?.length ? filter.appliesIn.map(({ dimensionId, valueId }) => `${dimensionId}:${valueId}`).join(',') : undefined,
    })
  }

  /** One rule by its key: R-7. */
  one(workspaceId: string, key: string) {
    return this.get<RuleDTO>(`/${workspaceId}/rules/${key}`)
  }

  /** A page of the rule's versions, newest first. */
  versions(workspaceId: string, key: string, page?: PageRequest) {
    return this.get<Page<RuleVersionDTO>>(`/${workspaceId}/rules/${key}/versions`, page)
  }
}
