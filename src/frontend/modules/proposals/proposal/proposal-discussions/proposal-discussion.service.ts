import { DiscussionCommentApi, DiscussionCommentInputSchema, type DiscussionCommentDTO } from '@newt/api/discussion-comment'
import { DiscussionApi } from '@newt/api/discussion'
import { toast } from '@newt/ui/components/toast'
import { FormStore } from '../../../../core/form/form-store'
import { inject } from '../../../../core/injector/inject'
import { ListStore } from '../../../../core/list/list-store'
import { Store } from '../../../../core/store/store'
import { ProposalService } from '../proposal.service'
import { ProposalDiscussionsService } from './proposal-discussions.service'

/** One conversation: what was said in it, replying, and editing one's own comments. */
export class ProposalDiscussionService {

  private readonly api = inject(DiscussionApi)
  private readonly commentApi = inject(DiscussionCommentApi)
  private readonly proposal = inject(ProposalService)
  private readonly discussions = inject(ProposalDiscussionsService)
  private readonly store = new Store<{ discussionId: string, open: boolean, editing: string | null }>({ discussionId: '', open: false, editing: null })

  readonly open = this.store.select('open')
  readonly editing = this.store.select('editing')
  readonly comments = new ListStore<DiscussionCommentDTO>(page => this.api.comments(this.proposal.workspaceId, this.store.value.discussionId, page))
  readonly replyForm = new FormStore(DiscussionCommentInputSchema, { body: '' }, { errorFields: { 'workspace.archived': 'body', validation: 'body' } })
  readonly editForm = new FormStore(DiscussionCommentInputSchema, { body: '' }, { errorFields: { 'discussionComment.not_yours': 'body', validation: 'body' } })

  /** Opens it: every comment, and replying. */
  async expand(discussionId: string): Promise<void> {
    this.store.patch({ discussionId, open: true })
    this.replyForm.reset({ body: '' })
    await this.comments.loadFirstPage()
  }

  collapse(): void {
    this.store.patch({ open: false, editing: null })
  }

  async reply(): Promise<void> {
    const sent = await this.replyForm.submit(async ({ body }) => {
      await this.api.reply(this.proposal.workspaceId, this.store.value.discussionId, body)
    })
    if (!sent) return
    this.replyForm.reset({ body: '' })
    await Promise.all([this.comments.loadFirstPage(), this.discussions.changed()])
  }

  startEdit(comment: DiscussionCommentDTO): void {
    this.editForm.reset({ body: comment.body })
    this.store.patch({ editing: comment.id })
  }

  cancelEdit(): void {
    this.store.patch({ editing: null })
  }

  async saveEdit(): Promise<void> {
    const commentId = this.store.value.editing
    if (!commentId) return
    let saved: DiscussionCommentDTO | undefined
    await this.editForm.submit(async ({ body }) => {
      saved = await this.commentApi.edit(this.proposal.workspaceId, commentId, body)
    })
    if (!saved) return
    this.comments.replace(saved)
    this.cancelEdit()
    toast.success('Comment edited')
  }
}
