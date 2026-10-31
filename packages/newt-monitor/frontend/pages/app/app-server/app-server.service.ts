import { inject, Store } from 'newt-react'
import { DEFAULT_BUCKET, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { InstancesApi, type ServerSeriesDTO } from '../../../api/instances'
import { AppService } from '../app.service'

type ServerState = {
  server: string
  window: MetricsWindow
  bucket: MetricsBucket
  series: ServerSeriesDTO | null
  failure: string | null
}

/** One server of the application over a window: its memory, its processors and its disks. What it is now is AppService's. */
export class AppServerService {

  private readonly instances = inject(InstancesApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<ServerState>({ server: '', window: '24h', bucket: DEFAULT_BUCKET['24h'], series: null, failure: null })

  readonly window = this.store.select('window')
  readonly bucket = this.store.select('bucket')
  readonly series = this.store.select('series')
  readonly failure = this.store.select('failure')

  async open(server: string): Promise<void> {
    this.store.patch({ server, series: null })
    await Promise.all([this.app.loadInstances(), this.load()])
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
    const { server, window, bucket } = this.store.value
    this.store.patch({ failure: null })
    try {
      const series = await this.instances.server(this.app.appId, { server, window, bucket })
      if (this.store.value.server === server && this.store.value.window === window && this.store.value.bucket === bucket) this.store.patch({ series })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the server' })
    }
  }
}
