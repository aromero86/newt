import { ApiError, inject, Store } from 'newt-react'
import { TracesApi, type TraceDTO } from '../../../api/traces'
import { AppService } from '../app.service'

type TraceState = {
  /** The trace the page is about. */
  focus: string | null
  /** The trace at the top of what is shown: the one the page is about, or one that caused it, unfolded upwards. */
  top: string | null
  /** Every trace loaded, by id. */
  traces: Record<string, TraceDTO>
  /** The traces of jobs unfolded: their steps shown inside the trace that told their event. */
  unfolded: string[]
  /** Those on their way. */
  loading: string[]
  /** The step said more of, of which trace. */
  selected: { traceId: string, spanId: string } | null
  failure: string | null
  notFound: boolean
}

/**
 * One trace of the application, and the flow it is part of: the jobs its events
 * caused, unfolded inside it as asked, and the traces that caused it, unfolded above it.
 */
export class AppTraceService {

  private readonly api = inject(TracesApi)
  private readonly app = inject(AppService)
  /** Which open is the last asked for: what an older one, or a load it started, answers later is dropped. */
  private opening = 0
  private readonly store = new Store<TraceState>({ focus: null, top: null, traces: {}, unfolded: [], loading: [], selected: null, failure: null, notFound: false })

  readonly focus = this.store.select('focus')
  readonly top = this.store.select('top')
  readonly traces = this.store.select('traces')
  readonly unfolded = this.store.select('unfolded')
  readonly loading = this.store.select('loading')
  readonly selected = this.store.select('selected')
  readonly failure = this.store.select('failure')
  readonly notFound = this.store.select('notFound')

  async open(traceId: string): Promise<void> {
    const opening = ++this.opening
    this.store.patch({ focus: null, top: null, traces: {}, unfolded: [], loading: [], selected: null, failure: null, notFound: false })
    try {
      const trace = await this.api.trace(this.app.appId, traceId)
      if (opening !== this.opening) return
      const failed = trace.spans.find(span => span.failure) ?? trace.spans.find(span => span.outcome && span.kind !== trace.kind)
      this.store.patch({ focus: trace.id, top: trace.id, traces: { [trace.id]: trace }, selected: { traceId: trace.id, spanId: (failed ?? trace.spans[0])!.id } })
    } catch (error) {
      if (opening !== this.opening) return
      if (error instanceof ApiError && error.status === 404) this.store.patch({ notFound: true })
      else this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the trace' })
    }
  }

  /** Shows a job's steps inside the trace that told its event, or folds them away. */
  async toggle(traceId: string): Promise<void> {
    const { unfolded } = this.store.value
    if (unfolded.includes(traceId)) return this.store.patch({ unfolded: unfolded.filter(each => each !== traceId) })
    if (await this.load(traceId)) this.store.patch({ unfolded: [...this.store.value.unfolded, traceId] })
  }

  /** Shows the trace that caused the one on top, with it unfolded inside: one step up the flow. */
  async unfoldCause(): Promise<void> {
    const { top, traces } = this.store.value
    const cause = top ? traces[top]?.causedBy : null
    if (!cause || !await this.load(cause.id)) return
    this.store.patch({ top: cause.id, unfolded: [...this.store.value.unfolded, top!] })
  }

  /** Back to the trace the page is about, alone. */
  foldCauses(): void {
    this.store.patch({ top: this.store.value.focus })
  }

  select(traceId: string, spanId: string): void {
    this.store.patch({ selected: { traceId, spanId } })
  }

  private async load(traceId: string): Promise<boolean> {
    if (this.store.value.traces[traceId]) return true
    const opening = this.opening
    this.store.patch({ loading: [...this.store.value.loading, traceId] })
    try {
      const trace = await this.api.trace(this.app.appId, traceId)
      if (opening !== this.opening) return false
      this.store.patch({ traces: { ...this.store.value.traces, [trace.id]: trace } })
      return true
    } catch (error) {
      if (opening === this.opening) this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the trace' })
      return false
    } finally {
      if (opening === this.opening) this.store.patch({ loading: this.store.value.loading.filter(each => each !== traceId) })
    }
  }
}
