import { ProposalApi } from '@newt/api/proposal'
import { toast } from '@newt/ui/components/toast'
import { z } from 'zod'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { Store } from '../../../../core/store/store'
import { ProposalService } from '../proposal.service'

const PublishSchema = z.object({ message: z.string().trim().min(1, 'Say what this revision changes').max(200, 'Keep it under 200 characters') })

/**
 * The working copy of a proposal: its document as it is being written, until a
 * revision publishes it with the deltas read from it. Reviewers do not see it.
 */
export class ProposalWorkingService {

  private readonly api = inject(ProposalApi)
  private readonly proposal = inject(ProposalService)
  private readonly store = new Store({ draft: '', preview: false, saving: false, editingDocument: false, publishing: false })

  /** The document being typed; saved with `saveDocument`. */
  readonly draft = this.store.select('draft')
  readonly preview = this.store.select('preview')
  readonly saving = this.store.select('saving')
  readonly editingDocument = this.store.select('editingDocument')
  readonly publishing = this.store.select('publishing')

  readonly publishForm = new FormStore(PublishSchema, { message: '' }, { errorFields: { 'proposal.nothing_to_publish': 'message' } })

  load(): void {
    this.store.patch({ draft: this.proposal.proposal.peek()?.document ?? '', preview: false })
    this.publishForm.reset({ message: '' })
  }

  openDocument(): void {
    this.store.patch({ editingDocument: true, preview: false, draft: this.proposal.proposal.peek()?.document ?? '' })
  }

  closeDocument(): void {
    this.store.patch({ editingDocument: false })
  }

  openPublish(): void {
    this.publishForm.reset({ message: '' })
    this.store.patch({ publishing: true })
  }

  closePublish(): void {
    this.store.patch({ publishing: false })
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
      this.closeDocument()
      toast.success('Document saved in the working copy')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      this.store.patch({ saving: false })
    }
  }

  /** The working copy as the next revision, with the deltas newt reads from its document: now reviewers see it. */
  async publish(): Promise<void> {
    const published = await this.publishForm.submit(async ({ message }) => {
      await this.api.publish(this.proposal.workspaceId, this.proposal.key, message)
    })
    if (!published) return
    this.closePublish()
    await this.proposal.refresh()
    toast.success('Revision published, with the deltas read from the document')
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
      if (done) toast.success(done)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
