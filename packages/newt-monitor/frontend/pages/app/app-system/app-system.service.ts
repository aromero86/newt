import { inject, Store } from 'newt-react'
import { DEFAULT_BUCKET, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { InstancesApi, type InstanceCountSeriesDTO, type SystemSeriesDTO } from '../../../api/instances'
import { AppService } from '../app.service'

type SystemState = {
  window: MetricsWindow
  bucket: MetricsBucket
  /** Whether the system and its instances now were asked for: they are AppService's. */
  loaded: boolean
  count: InstanceCountSeriesDTO | null
  series: SystemSeriesDTO | null
  failure: string | null
}

/** The application's system over a window: how many instances were alive, the application and the machines it ran on. What it is now is AppService's. */
export class AppSystemService {

  private readonly instances = inject(InstancesApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<SystemState>({ window: '24h', bucket: DEFAULT_BUCKET['24h'], loaded: false, count: null, series: null, failure: null })

  readonly window = this.store.select('window')
  readonly bucket = this.store.select('bucket')
  readonly loaded = this.store.select('loaded')
  readonly count = this.store.select('count')
  readonly series = this.store.select('series')
  readonly failure = this.store.select('failure')

  async open(): Promise<void> {
    this.store.patch({ loaded: false, count: null, series: null })
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
      const [count, series] = await Promise.all([
        this.instances.count(this.app.appId, { window, bucket }),
        this.instances.system(this.app.appId, { window, bucket }),
      ])
      if (this.store.value.window === window && this.store.value.bucket === bucket) this.store.patch({ count, series })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the system' })
    }
  }
}
