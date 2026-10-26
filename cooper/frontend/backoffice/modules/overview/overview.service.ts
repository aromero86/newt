import { BackofficeMetricApi, type MetricsOverviewDTO } from '@cooper/api/backoffice-metric'
import { inject } from '@cooper/core/injector/inject'
import { Store } from '@cooper/core/store/store'

type OverviewState = {
  metrics: MetricsOverviewDTO | null
  failure: string | null
}

/** cooper's numbers, as the backoffice's analytics add them up. */
export class OverviewService {

  private readonly api = inject(BackofficeMetricApi)
  private readonly store = new Store<OverviewState>({ metrics: null, failure: null })

  readonly metrics = this.store.select('metrics')
  readonly failure = this.store.select('failure')

  async load(): Promise<void> {
    this.store.patch({ failure: null })
    try {
      this.store.patch({ metrics: await this.api.overview() })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the numbers' })
    }
  }
}
