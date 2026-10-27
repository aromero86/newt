import { inject, Store } from 'newt-react'
import { DEFAULT_BUCKET, EventMetricsApi, type MetricsBucket, type MetricsWindow, type SeriesDTO, type TopDTO } from '../../../api/event-metrics'
import { AppService } from '../app.service'

export type Compare = 'previous' | 'week' | 'none'

type EventState = {
  context: string
  event: string
  window: MetricsWindow
  bucket: MetricsBucket
  compare: Compare
  /** Only what was told in this scope: `workspace:01a1…`. */
  scope: string | null
  /** Only what this actor told. */
  actor: string | null
  series: SeriesDTO | null
  /** Who told it most: `actor`, and `scope:<name>` for each scope it was told in. */
  tops: { by: string, top: TopDTO[] }[]
  loading: boolean
  failure: string | null
}

/** One event of the application: its series as asked for, and who tells it most. */
export class AppEventService {

  private readonly api = inject(EventMetricsApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<EventState>({
    context: '', event: '', window: '24h', bucket: DEFAULT_BUCKET['24h'], compare: 'previous',
    scope: null, actor: null, series: null, tops: [], loading: false, failure: null,
  })

  readonly window = this.store.select('window')
  readonly bucket = this.store.select('bucket')
  readonly compare = this.store.select('compare')
  readonly scope = this.store.select('scope')
  readonly actor = this.store.select('actor')
  readonly series = this.store.select('series')
  readonly tops = this.store.select('tops')
  readonly loading = this.store.select('loading')
  readonly failure = this.store.select('failure')

  open(context: string, event: string): Promise<void> {
    this.store.patch({ context, event, scope: null, actor: null, series: null, tops: [] })
    return this.load()
  }

  /** Another window, in its own bucket by default. */
  showWindow(window: MetricsWindow): Promise<void> {
    this.store.patch({ window, bucket: DEFAULT_BUCKET[window] })
    return this.load()
  }

  showBucket(bucket: MetricsBucket): Promise<void> {
    this.store.patch({ bucket })
    return this.load()
  }

  compareWith(compare: Compare): Promise<void> {
    this.store.patch({ compare })
    return this.load()
  }

  /** Only what one actor told, or what was told in one scope; null for all again. */
  filter(filter: { actor?: string | null, scope?: string | null }): Promise<void> {
    this.store.patch(filter)
    return this.load()
  }

  private async load(): Promise<void> {
    const { context, event, window, bucket, compare, scope, actor } = this.store.value
    const appId = this.app.appId
    this.store.patch({ loading: true, failure: null })
    try {
      const [series, scopes] = await Promise.all([
        this.api.series(appId, { context, event, window, bucket, compare, ...(scope ? { scope } : {}), ...(actor ? { actor } : {}) }),
        this.api.scopes(appId, { context, event, window }),
      ])
      const by = ['actor', ...scopes.slice(0, 3).map(name => `scope:${name}`)]
      const tops = await Promise.all(by.map(async each => ({ by: each, top: await this.api.top(appId, { context, event, window, by: each }) })))
      // Another event or window may have been asked for meanwhile.
      if (this.store.value.context === context && this.store.value.event === event && this.store.value.window === window) this.store.patch({ series, tops })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load its metrics' })
    } finally {
      this.store.patch({ loading: false })
    }
  }
}
