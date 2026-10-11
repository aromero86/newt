import { ApiError } from '@newt/api/core/api-error'
import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { FeatureApi } from '@newt/api/feature'
import { FeatureAreaApi } from '@newt/api/feature-area'
import { ProposalApi, type DeltaDTO, type DeltaInputDTO, type ProposalAction, type ProposalDTO } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { z } from 'zod'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

type ProposalState = {
  workspaceId: string
  key: string
  /** Undefined while loading; null if there is no such proposal. */
  proposal: ProposalDTO | null | undefined
  /** The workspace's dimensions, to name the values a scope points at. */
  dimensions: DimensionDTO[]
  /** Names of the areas and features the deltas point at, by id. */
  names: Record<string, string>
  /** The delta being rejected, whose reason is being written. */
  rejecting: DeltaDTO | null
}

const RejectSchema = z.object({ reason: z.string().trim().min(1, 'Say why').max(2000, 'Keep it under 2000 characters') })

const DONE: Record<ProposalAction, string> = {
  submit: 'Sent to review',
  draft: 'Back to draft',
  accept: 'Accepted: it is the brief for development now',
  reopen: 'Back in review',
  merge: 'Merged: its deltas are in the definition',
  discard: 'Discarded',
}

/** One proposal: its lifecycle, and its deltas page by page with their verdicts. */
export class ProposalService {

  private readonly api = inject(ProposalApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly areaApi = inject(FeatureAreaApi)
  private readonly featureApi = inject(FeatureApi)
  private readonly store = new Store<ProposalState>({ workspaceId: '', key: '', proposal: undefined, dimensions: [], names: {}, rejecting: null })

  readonly proposal = this.store.select('proposal')
  readonly dimensions = this.store.select('dimensions')
  readonly names = this.store.select('names')
  readonly rejecting = this.store.select('rejecting')

  readonly deltas = new ListStore<DeltaDTO>(page => this.api.deltas(this.store.value.workspaceId, this.store.value.key, page))

  readonly rejectForm = new FormStore(RejectSchema, { reason: '' })

  get workspaceId(): string {
    return this.store.value.workspaceId
  }

  async load(workspaceId: string, key: string): Promise<void> {
    this.store.patch({ workspaceId, key, proposal: undefined, names: {}, rejecting: null })
    try {
      const [proposal, dimensions] = await Promise.all([this.api.one(workspaceId, key), this.dimensionApi.list(workspaceId)])
      this.store.patch({ proposal, dimensions })
      await this.loadDeltas()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ proposal: null })
      else throw error
    }
  }

  async act(action: ProposalAction): Promise<void> {
    const { workspaceId, key } = this.store.value
    await this.attempt(async () => {
      this.store.patch({ proposal: await this.api.act(workspaceId, key, action) })
      // Merging changes the definition the deltas compare with: what they show is read again.
      if (action === 'merge') this.store.patch({ dimensions: await this.dimensionApi.list(workspaceId) })
    }, DONE[action])
  }

  async addDelta(delta: DeltaInputDTO): Promise<void> {
    const { workspaceId, key } = this.store.value
    await this.api.addDelta(workspaceId, key, delta)
    await this.refresh()
  }

  async approve(delta: DeltaDTO): Promise<void> {
    await this.attempt(() => this.api.review(this.workspaceId, this.store.value.key, delta.id, { verdict: 'approved' }).then(() => {}))
  }

  openReject(delta: DeltaDTO): void {
    this.rejectForm.reset({ reason: '' })
    this.store.patch({ rejecting: delta })
  }

  closeReject(): void {
    this.store.patch({ rejecting: null })
  }

  async reject(): Promise<void> {
    const { workspaceId, key, rejecting } = this.store.value
    if (!rejecting) return
    const done = await this.rejectForm.submit(async ({ reason }) => {
      await this.api.review(workspaceId, key, rejecting.id, { verdict: 'rejected', reason })
    })
    if (done) {
      this.closeReject()
      await this.refresh()
    }
  }

  async withdraw(delta: DeltaDTO): Promise<void> {
    await this.attempt(() => this.api.withdrawReview(this.workspaceId, this.store.value.key, delta.id).then(() => {}))
  }

  async remove(delta: DeltaDTO): Promise<void> {
    await this.attempt(() => this.api.removeDelta(this.workspaceId, this.store.value.key, delta.id), 'Delta removed')
  }

  /** The name of an area or a feature a delta points at. */
  name(id: string): string {
    return this.store.value.names[id] ?? 'Unknown'
  }

  private async attempt(action: () => Promise<void>, done?: string): Promise<void> {
    try {
      await action()
      await this.refresh()
      if (done) toast.success(done)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  /** The proposal's counts and its deltas, read again after any change. */
  private async refresh(): Promise<void> {
    const { workspaceId, key } = this.store.value
    this.store.patch({ proposal: await this.api.one(workspaceId, key) })
    await this.loadDeltas()
  }

  private async loadDeltas(): Promise<void> {
    await this.deltas.loadFirstPage()
    await this.resolveNames(this.deltas.items.peek())
  }

  /** Names for the areas and features the deltas point at: created by a delta, or read from the definition. */
  private async resolveNames(deltas: DeltaDTO[]): Promise<void> {
    const names: Record<string, string> = { ...this.store.value.names }
    for (const delta of deltas) {
      if (delta.operation === 'create' && (delta.kind === 'feature-area' || delta.kind === 'feature')) names[delta.targetId] = delta.targetLabel
    }
    const wanted = new Map<string, 'area' | 'feature'>()
    for (const delta of deltas) {
      for (const state of [delta.before, delta.after] as ({ areaId?: string, featureId?: string } | null)[]) {
        if (state?.areaId && !names[state.areaId]) wanted.set(state.areaId, 'area')
        if (state?.featureId && !names[state.featureId]) wanted.set(state.featureId, 'feature')
      }
    }
    const { workspaceId } = this.store.value
    await Promise.all([...wanted].map(async ([id, kind]) => {
      try {
        names[id] = (kind === 'area' ? await this.areaApi.one(workspaceId, id) : await this.featureApi.one(workspaceId, id)).name
      } catch {
        names[id] = 'Unknown'
      }
    }))
    this.store.patch({ names })
  }
}
