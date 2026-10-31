import { inject, Store } from 'newt-react'
import { DEFAULT_BUCKET, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { InstancesApi, type InstanceCountSeriesDTO } from '../../../api/instances'
import { AppService } from '../app.service'

type ServersState = {
  window: MetricsWindow
  bucket: MetricsBucket
  /** Whether its servers and instances were asked for: they are AppService's. */
  loaded: boolean
  count: InstanceCountSeriesDTO | null
  failure: string | null
}

/** The application's servers and instances: how many were alive over a window. What they are now is AppService's. */
export class AppServersService {

  private readonly instances = inject(InstancesApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<ServersState>({ window: '24h', bucket: DEFAULT_BUCKET['24h'], loaded: false, count: null, failure: null })

  readonly window = this.store.select('window')
  readonly bucket = this.store.select('bucket')
  readonly loaded = this.store.select('loaded')
  readonly count = this.store.select('count')
  readonly failure = this.store.select('failure')

  async open(): Promise<void> {
    this.store.patch({ loaded: false, count: null })
    await Promise.all([this.app.loadInstances().then(() => this.store.patch({ loaded: true })), this.load()])
  }

  showWindow(window: MetricsWindow): Promise<void> {
    this.store.patch({ window, bucket: DEFAULT_BUCKET[window] })
    return this.load()
  }

  showBucket(bucket: MetricsBucket): Promise<void> {
    this.store.patch({ bucket })
    return this.load()
  }

  private async load(): Promise<void> {
    const { window, bucket } = this.store.value
    this.store.patch({ failure: null })
    try {
      const count = await this.instances.count(this.app.appId, { window, bucket })
      if (this.store.value.window === window && this.store.value.bucket === bucket) this.store.patch({ count })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load how many instances were alive' })
    }
  }
}
