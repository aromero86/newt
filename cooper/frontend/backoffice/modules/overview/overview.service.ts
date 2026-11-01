import { BackofficeMetricApi, type MetricsOverviewDTO } from '@cooper/api/backoffice-metric'
import { BackofficeWorkspaceApi, type RecentBoardDTO } from '@cooper/api/backoffice-workspace'
import { inject, Store } from '@newt-kit/react'

type OverviewState = {
  metrics: MetricsOverviewDTO | null
  /** The boards created last, whatever their workspace: a few, never paged. */
  recentBoards: RecentBoardDTO[] | null
  failure: string | null
}

/** cooper's numbers, as the backoffice's analytics add them up, and the boards made last. */
export class OverviewService {

  private readonly api = inject(BackofficeMetricApi)
  private readonly workspaces = inject(BackofficeWorkspaceApi)
  private readonly store = new Store<OverviewState>({ metrics: null, recentBoards: null, failure: null })

  readonly metrics = this.store.select('metrics')
  readonly recentBoards = this.store.select('recentBoards')
  readonly failure = this.store.select('failure')

  async load(): Promise<void> {
    this.store.patch({ failure: null })
    try {
      const [metrics, recentBoards] = await Promise.all([this.api.overview(), this.workspaces.recentBoards()])
      this.store.patch({ metrics, recentBoards })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the numbers' })
    }
  }
}
