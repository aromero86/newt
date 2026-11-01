import { inject, Store } from '@newt-kit/react'
import { DEFAULT_BUCKET, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { OutboxApi, type DeadJob, type DepthSeriesDTO, type OutboxQueueDTO } from '../../../api/outbox'
import { QueueMetricsApi, type QueueSeriesDTO } from '../../../api/queue-metrics'
import { AppService } from '../app.service'

export type Compare = 'previous' | 'week' | 'none'

type QueueState = {
  context: string
  queue: string
  window: MetricsWindow
  bucket: MetricsBucket
  compare: Compare
  /** How it is now, as the last snapshot found it: null for a queue with no job. */
  current: OutboxQueueDTO | null
  flow: QueueSeriesDTO | null
  depth: DepthSeriesDTO | null
  dead: DeadJob[]
  /** The last dead job of the page the application answered, kept or not: where its next page starts. */
  deadCursor: string | undefined
  moreDead: boolean
  deadFailure: string | null
  failure: string | null
}

/** One queue of the application: how full it is and was, how it flowed, how long its jobs waited, and its dead jobs. */
export class AppQueueService {

  private readonly queues = inject(QueueMetricsApi)
  private readonly outbox = inject(OutboxApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<QueueState>({
    context: '', queue: '', window: '24h', bucket: DEFAULT_BUCKET['24h'], compare: 'previous',
    current: null, flow: null, depth: null, dead: [], deadCursor: undefined, moreDead: false, deadFailure: null, failure: null,
  })

  readonly window = this.store.select('window')
  readonly bucket = this.store.select('bucket')
  readonly compare = this.store.select('compare')
  readonly current = this.store.select('current')
  readonly flow = this.store.select('flow')
  readonly depth = this.store.select('depth')
  readonly dead = this.store.select('dead')
  readonly moreDead = this.store.select('moreDead')
  readonly deadFailure = this.store.select('deadFailure')
  readonly failure = this.store.select('failure')

  /** The latest load and loadDead asked: an answer to an older one is dropped. */
  private loadSeq = 0
  private deadSeq = 0

  async open(context: string, queue: string): Promise<void> {
    this.store.patch({ context, queue, current: null, flow: null, depth: null, dead: [], deadCursor: undefined, moreDead: false, deadFailure: null })
    await Promise.all([this.load(), this.loadDead()])
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

  /** Its next page of dead jobs, asked of the application: they are of its context, so filtered by queue here. */
  async loadDead(): Promise<void> {
    const { context, queue, dead, deadCursor } = this.store.value
    const seq = ++this.deadSeq
    try {
      const page = await this.outbox.dead(this.app.appId, { context, after: deadCursor, limit: 100 })
      if (seq !== this.deadSeq) return
      this.store.patch({
        dead: [...dead, ...page.jobs.filter(job => job.queue === queue)],
        deadCursor: page.jobs.at(-1)?.id ?? deadCursor,
        moreDead: page.hasMore,
        deadFailure: null,
      })
    } catch (error) {
      if (seq !== this.deadSeq) return
      this.store.patch({ deadFailure: error instanceof Error ? error.message : 'Could not ask it for its dead jobs' })
    }
  }

  private async load(): Promise<void> {
    const { context, queue, window, bucket, compare } = this.store.value
    const appId = this.app.appId
    const seq = ++this.loadSeq
    this.store.patch({ failure: null })
    try {
      const [current, flow, depth] = await Promise.all([
        this.outbox.current(appId),
        this.queues.series(appId, { context, queue, window, bucket, compare }),
        this.outbox.depth(appId, { context, queue, window, bucket }),
      ])
      if (seq !== this.loadSeq) return
      this.store.patch({ current: current.queues.find(each => each.context === context && each.queue === queue) ?? null, flow, depth })
    } catch (error) {
      if (seq !== this.loadSeq) return
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the queue' })
    }
  }
}
