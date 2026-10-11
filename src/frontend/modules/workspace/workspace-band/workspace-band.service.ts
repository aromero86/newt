import { ProposalApi } from '@newt/api/proposal'
import { ReleaseApi } from '@newt/api/release'
import { inject } from '../../../core/injector/inject'
import { Store } from '../../../core/store/store'

/** The numbers the workspace's tabs show: open proposals and releases. */
export class WorkspaceBandService {

  private readonly proposalApi = inject(ProposalApi)
  private readonly releaseApi = inject(ReleaseApi)
  private readonly store = new Store<{ openProposals: number | undefined, releases: number | undefined }>({ openProposals: undefined, releases: undefined })

  readonly openProposals = this.store.select('openProposals')
  readonly releases = this.store.select('releases')

  /** Read again on every page: they change with what happens in it. */
  async load(workspaceId: string): Promise<void> {
    try {
      const [proposals, releases] = await Promise.all([
        this.proposalApi.list(workspaceId, ['draft', 'in review'], { size: 1 }),
        this.releaseApi.list(workspaceId, { size: 1 }),
      ])
      this.store.patch({ openProposals: proposals.total, releases: releases.total })
    } catch {
      // Counts are a nicety: without them the tabs still work.
    }
  }
}
