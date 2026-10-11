import { ApiError } from '@newt/api/core/api-error'
import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { DiscussionApi, type DiscussionCounts } from '@newt/api/discussion'
import { ProposalApi, type DeltaDTO, type DeltaInputDTO, type ProposalAction, type ProposalDTO } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { z } from 'zod'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'

type ProposalState = {
  workspaceId: string
  key: string
  /** Undefined while loading; null if there is no such proposal. */
  proposal: ProposalDTO | null | undefined
  /** The document as the last revision published it. */
  publishedDocument: string
  /** The workspace's dimensions, to name the values a scope points at. */
  dimensions: DimensionDTO[]
  /** The delta being rejected, whose reason is being written. */
  rejecting: DeltaDTO | null
  /** Sending to review is asking for the message of the revision it publishes. */
  submitting: boolean
  /** Conversations by delta, and on the proposal in general under ''. */
  discussionCounts: Record<string, DiscussionCounts>
}

const RejectSchema = z.object({ reason: z.string().trim().min(1, 'Say why').max(2000, 'Keep it under 2000 characters') })
const MessageSchema = z.object({ message: z.string().trim().min(1, 'Say what this revision changes').max(200, 'Keep it under 200 characters') })

const DONE: Record<ProposalAction, string> = {
  draft: 'Back to draft',
  accept: 'Accepted: it is the brief for development now',
  reopen: 'Back in review',
  merge: 'Merged: its deltas are in the definition',
  discard: 'Discarded',
}

/**
 * One proposal: its lifecycle and what reviewers see, the last revision published,
 * with the verdicts on its deltas. The working copy has its own service.
 */
export class ProposalService {

  private readonly api = inject(ProposalApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly discussionApi = inject(DiscussionApi)
  private readonly artifactNames = inject(ArtifactNamesService)
  private readonly store = new Store<ProposalState>({ workspaceId: '', key: '', proposal: undefined, publishedDocument: '', dimensions: [], rejecting: null, submitting: false, discussionCounts: {} })

  readonly proposal = this.store.select('proposal')
  readonly publishedDocument = this.store.select('publishedDocument')
  readonly dimensions = this.store.select('dimensions')
  readonly rejecting = this.store.select('rejecting')
  readonly submitting = this.store.select('submitting')
  readonly discussionCounts = this.store.select('discussionCounts')
  readonly names = this.artifactNames.names

  /** The deltas as the last revision published them: what is reviewed. */
  readonly deltas = new ListStore<DeltaDTO>(page => this.api.deltas(this.store.value.workspaceId, this.store.value.key, 'published', page))

  readonly rejectForm = new FormStore(RejectSchema, { reason: '' })
  readonly submitForm = new FormStore(MessageSchema, { message: 'First revision' })

  get workspaceId(): string {
    return this.store.value.workspaceId
  }

  get key(): string {
    return this.store.value.key
  }

  async load(workspaceId: string, key: string): Promise<void> {
    this.store.patch({ workspaceId, key, proposal: undefined, rejecting: null, submitting: false })
    try {
      const [proposal, dimensions] = await Promise.all([this.api.one(workspaceId, key), this.dimensionApi.list(workspaceId)])
      this.store.patch({ proposal, dimensions })
      await this.loadPublished()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ proposal: null })
      else throw error
    }
  }

  async act(action: ProposalAction): Promise<void> {
    await this.attempt(async () => {
      this.store.patch({ proposal: await this.api.act(this.workspaceId, this.key, action) })
      // Merging changes the definition the deltas compare with: what they show is read again.
      if (action === 'merge') this.store.patch({ dimensions: await this.dimensionApi.list(this.workspaceId) })
    }, DONE[action])
  }

  /** To review: straight away if everything is published, or after asking for the revision's message. */
  async submit(): Promise<void> {
    const proposal = this.store.value.proposal
    if (!proposal) return
    if (proposal.revision > 0 && !proposal.unpublished) {
      await this.attempt(async () => this.store.patch({ proposal: await this.api.submit(this.workspaceId, this.key) }), 'Sent to review')
      return
    }
    this.submitForm.reset({ message: proposal.revision === 0 ? 'First revision' : '' })
    this.store.patch({ submitting: true })
  }

  closeSubmit(): void {
    this.store.patch({ submitting: false })
  }

  async confirmSubmit(): Promise<void> {
    const sent = await this.submitForm.submit(async ({ message }) => {
      this.store.patch({ proposal: await this.api.submit(this.workspaceId, this.key, message) })
    })
    if (sent) {
      this.closeSubmit()
      await this.refresh()
      toast.success('Published and sent to review')
    }
  }

  async addDelta(delta: DeltaInputDTO): Promise<void> {
    await this.api.addDelta(this.workspaceId, this.key, delta)
    await this.refresh()
  }

  async rewriteDelta(deltaId: string, delta: DeltaInputDTO): Promise<void> {
    await this.api.rewriteDelta(this.workspaceId, this.key, deltaId, delta)
    await this.refresh()
  }

  async approve(delta: DeltaDTO): Promise<void> {
    await this.attempt(() => this.api.review(this.workspaceId, this.key, delta.id, { verdict: 'approved' }).then(() => {}))
  }

  openReject(delta: DeltaDTO): void {
    this.rejectForm.reset({ reason: '' })
    this.store.patch({ rejecting: delta })
  }

  closeReject(): void {
    this.store.patch({ rejecting: null })
  }

  async reject(): Promise<void> {
    const rejecting = this.store.value.rejecting
    if (!rejecting) return
    const done = await this.rejectForm.submit(async ({ reason }) => {
      await this.api.review(this.workspaceId, this.key, rejecting.id, { verdict: 'rejected', reason })
    })
    if (done) {
      this.closeReject()
      await this.refresh()
    }
  }

  async withdraw(delta: DeltaDTO): Promise<void> {
    await this.attempt(() => this.api.withdrawReview(this.workspaceId, this.key, delta.id).then(() => {}))
  }

  /** The name of an area or a feature a delta points at. */
  name(id: string): string {
    return this.artifactNames.name(id)
  }

  /** The proposal, its published document and deltas, read again after any change. */
  async refresh(): Promise<void> {
    this.store.patch({ proposal: await this.api.one(this.workspaceId, this.key) })
    await this.loadPublished()
  }

  async refreshDiscussionCounts(): Promise<void> {
    this.store.patch({ discussionCounts: await this.discussionApi.counts(this.workspaceId, this.key) })
  }

  /** Learns the names some deltas need, such as the working copy's. */
  resolveNames(deltas: DeltaDTO[]): Promise<void> {
    return this.artifactNames.resolve(this.workspaceId, deltas)
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

  private async loadPublished(): Promise<void> {
    const revision = this.store.value.proposal?.revision ?? 0
    const document = revision > 0 ? (await this.api.revision(this.workspaceId, this.key, revision)).document : ''
    this.store.patch({ publishedDocument: document })
    await Promise.all([this.deltas.loadFirstPage(), this.refreshDiscussionCounts()])
    await this.resolveNames(this.deltas.items.peek())
  }
}
