import { ApiError, inject, Store } from 'newt-react'
import { TracesApi, type TraceDTO } from '../../../api/traces'
import { AppService } from '../app.service'

type TraceState = {
  trace: TraceDTO | null
  /** The step said more of: the one that failed, else the first. */
  selected: string | null
  failure: string | null
  notFound: boolean
}

/** One trace of the application: its steps, the one selected, and what it is linked to. */
export class AppTraceService {

  private readonly api = inject(TracesApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<TraceState>({ trace: null, selected: null, failure: null, notFound: false })

  readonly trace = this.store.select('trace')
  readonly selected = this.store.select('selected')
  readonly failure = this.store.select('failure')
  readonly notFound = this.store.select('notFound')

  async open(traceId: string): Promise<void> {
    this.store.patch({ trace: null, selected: null, failure: null, notFound: false })
    try {
      const trace = await this.api.trace(this.app.appId, traceId)
      const failed = trace.spans.find(span => span.failure) ?? trace.spans.find(span => span.outcome && span.kind !== trace.kind)
      this.store.patch({ trace, selected: (failed ?? trace.spans[0])?.id ?? null })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ notFound: true })
      else this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the trace' })
    }
  }

  select(spanId: string): void {
    this.store.patch({ selected: spanId })
  }
}
