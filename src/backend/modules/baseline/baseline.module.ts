import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import type { BaselinePlannedDTO } from './baseline.schema'
import type { Baseline_Deps } from './baseline.deps'
import { registerBaselineRoutes } from './baseline.routes'

/**
 * The two definitions of a workspace, and how each artifact got there. The one in force is what the definition
 * modules hold: everything merged. The planned one adds what is accepted and has no
 * code yet: this module tells those changes apart.
 */
export class Baseline_Module extends Module {

  static async initialize(base: Base, deps: Baseline_Deps) {
    const module = new Baseline_Module(base, deps)
    registerBaselineRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly deps: Baseline_Deps) {
    super('baseline', base.transactions)
  }

  /**
   * A page of the changes accepted and not merged yet, in the order they were
   * written; only those on these artifacts, if given.
   */
  @UseCase('baseline.planned')
  async planned(workspaceId: string, targetIds: string[] | undefined, page: PageRequest): Promise<Page<BaselinePlannedDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const accepted = await this.deps.proposal.find(workspaceId, { status: ['accepted'] })
    if (accepted.length === 0) return { items: [], hasMore: false, total: 0 }

    const proposals = new Map(accepted.map(proposal => [proposal.id, { id: proposal.id, key: proposal.key, title: proposal.title }]))
    const deltas = await this.deps.delta.list(workspaceId, { proposalId: [...proposals.keys()], targetId: targetIds }, 'published', page)
    return { ...deltas, items: deltas.items.map(delta => ({ proposal: proposals.get(delta.proposalId)!, delta })) }
  }

  /**
   * For other modules: which artifacts the proposals merged after `after` and up to
   * `until` (ISO dates; open ends when absent) changed, and which proposal each.
   */
  @UseCase('baseline.mergedChanges')
  async mergedChanges(workspaceId: string, after: string | null, until: string | null): Promise<{ targetId: string, proposal: { key: string, title: string } }[]> {
    const merged = (await this.deps.proposal.find(workspaceId, { status: ['merged'] }))
      .filter(proposal => (!after || proposal.mergedAt! > after) && (!until || proposal.mergedAt! <= until))
    if (merged.length === 0) return []

    const proposals = new Map(merged.map(proposal => [proposal.id, { key: proposal.key, title: proposal.title }]))
    const changes: { targetId: string, proposal: { key: string, title: string } }[] = []
    for (let cursor: string | undefined, more = true; more;) {
      const page = await this.deps.delta.list(workspaceId, { proposalId: [...proposals.keys()] }, 'published', { size: 100, cursor })
      changes.push(...page.items.map(delta => ({ targetId: delta.targetId, proposal: proposals.get(delta.proposalId)! })))
      cursor = page.items.at(-1)?.id
      more = page.hasMore
    }
    return changes
  }

  /**
   * A page of the merged changes to an artifact, oldest first: the proposals that
   * made it what it is, each with its document.
   */
  @UseCase('baseline.history')
  async history(workspaceId: string, targetId: string, page: PageRequest): Promise<Page<BaselinePlannedDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const merged = await this.deps.proposal.find(workspaceId, { status: ['merged'] })
    if (merged.length === 0) return { items: [], hasMore: false, total: 0 }

    const proposals = new Map(merged.map(proposal => [proposal.id, { id: proposal.id, key: proposal.key, title: proposal.title }]))
    const deltas = await this.deps.delta.list(workspaceId, { proposalId: [...proposals.keys()], targetId: [targetId] }, 'published', page)
    return { ...deltas, items: deltas.items.map(delta => ({ proposal: proposals.get(delta.proposalId)!, delta })) }
  }
}
