import { inject, Store } from 'newt-react'
import { DEFAULT_BUCKET, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { UseCaseErrorsApi, type ErrorCodeDTO, type ErrorsSeriesDTO, type ErrorsTopDTO } from '../../../api/use-case-errors'
import { UseCaseMetricsApi, type UseCaseSeriesDTO, type UseCaseTopDTO } from '../../../api/use-case-metrics'
import { AppService } from '../app.service'

export type Compare = 'previous' | 'week' | 'none'
/** Who first in the lists: those who call it most, make it run again most, or end it in errors or failures most. */
export type TopOrder = 'calls' | 'retries' | 'errors' | 'failures'

type UseCaseState = {
  context: string
  useCase: string
  window: MetricsWindow
  bucket: MetricsBucket
  compare: Compare
  scope: string | null
  actor: string | null
  order: TopOrder
  series: UseCaseSeriesDTO | null
  /** How its calls ended badly over the same window and buckets, and by code. */
  errors: ErrorsSeriesDTO | null
  codes: ErrorCodeDTO[]
  /** Who calls it most: by actor, and by each scope it was called in. */
  tops: { by: string, top: (UseCaseTopDTO | ErrorsTopDTO)[] }[]
  failure: string | null
}

/** One use case of the application: how its calls went over a window, and who calls it most. */
export class AppUseCaseService {

  private readonly api = inject(UseCaseMetricsApi)
  private readonly errorsApi = inject(UseCaseErrorsApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<UseCaseState>({
    context: '', useCase: '', window: '24h', bucket: DEFAULT_BUCKET['24h'], compare: 'previous',
    scope: null, actor: null, order: 'calls', series: null, errors: null, codes: [], tops: [], failure: null,
  })

  readonly window = this.store.select('window')
  readonly bucket = this.store.select('bucket')
  readonly compare = this.store.select('compare')
  readonly scope = this.store.select('scope')
  readonly actor = this.store.select('actor')
  readonly order = this.store.select('order')
  readonly series = this.store.select('series')
  readonly errors = this.store.select('errors')
  readonly codes = this.store.select('codes')
  readonly tops = this.store.select('tops')
  readonly failure = this.store.select('failure')

  open(context: string, useCase: string): Promise<void> {
    this.store.patch({ context, useCase, scope: null, actor: null, series: null, tops: [] })
    return this.load()
  }

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

  orderBy(order: TopOrder): Promise<void> {
    this.store.patch({ order })
    return this.load()
  }

  filter(filter: { actor?: string | null, scope?: string | null }): Promise<void> {
    this.store.patch(filter)
    return this.load()
  }

  private async load(): Promise<void> {
    const { context, useCase, window, bucket, compare, scope, actor, order } = this.store.value
    const appId = this.app.appId
    this.store.patch({ failure: null })
    try {
      const filter = { ...(scope ? { scope } : {}), ...(actor ? { actor } : {}) }
      const [series, errors, codes] = await Promise.all([
        this.api.series(appId, { context, useCase, window, bucket, compare, ...filter }),
        this.errorsApi.series(appId, { context, useCase, window, bucket, ...filter }),
        this.errorsApi.codes(appId, { context, useCase, window, ...filter }),
      ])
      const scopes = await this.api.scopes(appId, { context, useCase, window })
      const by = ['actor', ...scopes.slice(0, 3).map(name => `scope:${name}`)]
      const tops = await Promise.all(by.map(async each => ({
        by: each,
        top: order === 'errors' || order === 'failures'
          ? await this.errorsApi.top(appId, { context, useCase, window, by: each, kind: order === 'errors' ? 'error' : 'failure' })
          : await this.api.top(appId, { context, useCase, window, by: each, order }),
      })))
      if (this.store.value.context === context && this.store.value.useCase === useCase && this.store.value.window === window) this.store.patch({ series, errors, codes, tops })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load its metrics' })
    }
  }
}
