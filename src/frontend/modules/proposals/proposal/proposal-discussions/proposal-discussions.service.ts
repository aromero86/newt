import { DiscussionCommentInputSchema } from '@newt/api/discussion-comment'
import { DiscussionApi, type DiscussionDTO } from '@newt/api/discussion'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { ListStore } from '../../../../core/list/list-store'
import { Store } from '../../../../core/store/store'
import { ProposalService } from '../proposal.service'

/** The conversations on a proposal in general, or on one of its deltas. */
export class ProposalDiscussionsService {

  private readonly api = inject(DiscussionApi)
  private readonly proposal = inject(ProposalService)
  private readonly store = new Store<{ deltaId: string | undefined }>({ deltaId: undefined })

  readonly discussions = new ListStore<DiscussionDTO>(page => this.api.list(this.proposal.workspaceId, this.proposal.key, this.store.value.deltaId, page))
  readonly form = new FormStore(DiscussionCommentInputSchema, { body: '' }, { errorFields: { 'workspace.archived': 'body', validation: 'body' } })

  async load(deltaId?: string): Promise<void> {
    this.store.patch({ deltaId })
    this.form.reset({ body: '' })
    await this.discussions.loadFirstPage()
  }

  async start(): Promise<void> {
    const started = await this.form.submit(async ({ body }) => {
      await this.api.start(this.proposal.workspaceId, this.proposal.key, body, this.store.value.deltaId)
    })
    if (!started) return
    this.form.reset({ body: '' })
    await this.changed()
  }

  async resolveDiscussion(discussion: DiscussionDTO): Promise<void> {
    await this.attempt(() => this.api.resolveDiscussion(this.proposal.workspaceId, discussion.id))
  }

  async reopen(discussion: DiscussionDTO): Promise<void> {
    await this.attempt(() => this.api.reopen(this.proposal.workspaceId, discussion.id))
  }

  /** The list, and the counts the proposal shows, read again. */
  async changed(): Promise<void> {
    await Promise.all([this.discussions.loadFirstPage(), this.proposal.refreshDiscussionCounts()])
  }

  private async attempt(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
      await this.changed()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
