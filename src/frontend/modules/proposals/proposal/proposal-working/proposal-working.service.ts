import { ProposalApi, type DeltaDTO } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { z } from 'zod'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { ListStore } from '../../../../core/list/list-store'
import { Store } from '../../../../core/store/store'
import { ProposalService } from '../proposal.service'

const PublishSchema = z.object({ message: z.string().trim().min(1, 'Say what this revision changes').max(200, 'Keep it under 200 characters') })

/**
 * The working copy of a proposal: its document and deltas as they are being
 * written, until a revision publishes them. Reviewers do not see any of it.
 */
export class ProposalWorkingService {

  private readonly api = inject(ProposalApi)
  private readonly proposal = inject(ProposalService)
  private readonly store = new Store({ draft: '', preview: false, saving: false })

  /** The document being typed; saved with `saveDocument`. */
  readonly draft = this.store.select('draft')
  readonly preview = this.store.select('preview')
  readonly saving = this.store.select('saving')

  readonly deltas = new ListStore<DeltaDTO>(page => this.api.deltas(this.proposal.workspaceId, this.proposal.key, 'working', page))
  readonly publishForm = new FormStore(PublishSchema, { message: '' }, { errorFields: { 'proposal.nothing_to_publish': 'message' } })

  async load(): Promise<void> {
    this.store.patch({ draft: this.proposal.proposal.peek()?.document ?? '', preview: false })
    this.publishForm.reset({ message: '' })
    await this.reload()
  }

  /** The deltas of the working copy, read again after any change. */
  async reload(): Promise<void> {
    await this.deltas.loadFirstPage()
    await this.proposal.resolveNames(this.deltas.items.peek())
  }

  type(draft: string): void {
    this.store.patch({ draft })
  }

  togglePreview(): void {
    this.store.patch({ preview: !this.store.value.preview })
  }

  /** A save, not a revision: reviewers still see the last one. */
  async saveDocument(): Promise<void> {
    this.store.patch({ saving: true })
    try {
      await this.api.writeDocument(this.proposal.workspaceId, this.proposal.key, this.store.value.draft)
      await this.proposal.refresh()
      toast.success('Document saved in the working copy')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      this.store.patch({ saving: false })
    }
  }

  async remove(delta: DeltaDTO): Promise<void> {
    await this.attempt(() => this.api.removeDelta(this.proposal.workspaceId, this.proposal.key, delta.id))
  }

  async undoRemove(delta: DeltaDTO): Promise<void> {
    await this.attempt(() => this.api.undoRemoveDelta(this.proposal.workspaceId, this.proposal.key, delta.id))
  }

  /** The working copy as the next revision: now reviewers see it. */
  async publish(): Promise<void> {
    const published = await this.publishForm.submit(async ({ message }) => {
      await this.api.publish(this.proposal.workspaceId, this.proposal.key, message)
    })
    if (!published) return
    this.publishForm.reset({ message: '' })
    await this.proposal.refresh()
    await this.reload()
    toast.success('Revision published')
  }

  /** Back to the last revision: what was not published is lost. */
  async discard(): Promise<void> {
    await this.attempt(async () => {
      const proposal = await this.api.discardChanges(this.proposal.workspaceId, this.proposal.key)
      this.store.patch({ draft: proposal.document })
    }, 'Changes discarded')
  }

  private async attempt(action: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await action()
      await this.proposal.refresh()
      await this.reload()
      if (done) toast.success(done)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
