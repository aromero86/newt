import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { DiscussionComment, DiscussionCommentInputSchema, type DiscussionCommentDTO, type DiscussionCommentInputDTO } from './discussion-comment'
import type { DiscussionComment_Deps } from './discussion-comment.deps'
import { DiscussionComment_Repository } from './discussion-comment.repository'
import { registerDiscussionCommentRoutes } from './discussion-comment.routes'
import { DiscussionCommentNotFound } from './errors/discussion-comment-not-found'

/**
 * What people say in each conversation, in order. It knows conversations only by
 * id: the discussion module decides who may write where, and calls in.
 */
export class DiscussionComment_Module extends Module {

  static async initialize(base: Base, deps: DiscussionComment_Deps) {
    const module = new DiscussionComment_Module(base, new DiscussionComment_Repository(base), deps)
    registerDiscussionCommentRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: DiscussionComment_Repository, private readonly deps: DiscussionComment_Deps) {
    super('discussion-comment', base.transactions)
  }

  /** For the discussion module: a new comment by the signed-in person in that conversation. */
  @UseCase('discussionComment.add')
  async add(workspaceId: string, discussionId: string, input: DiscussionCommentInputDTO): Promise<DiscussionCommentDTO> {
    const comment = DiscussionComment.create({ workspaceId, discussionId, authorId: currentActor().userId, body: DiscussionCommentInputSchema.parse(input).body })
    await this.repo.persist(comment)
    return (await this.contracts([comment]))[0]!
  }

  /** For the discussion module: a page of a conversation's comments, oldest first. */
  @UseCase('discussionComment.list')
  async list(discussionId: string, page: PageRequest): Promise<Page<DiscussionCommentDTO>> {
    const comments = await this.repo.page({ discussionId: [discussionId] }, page)
    return { ...comments, items: await this.contracts(comments.items) }
  }

  /** For the discussion module: the comment that started each conversation, and how many each has. */
  @UseCase('discussionComment.summaries')
  async summaries(discussionIds: string[]): Promise<Map<string, { first: DiscussionCommentDTO, comments: number }>> {
    if (discussionIds.length === 0) return new Map()
    const [firsts, counts] = await Promise.all([this.repo.find({ discussionId: discussionIds, first: true }), this.repo.counts(discussionIds)])
    const contracts = await this.contracts(firsts)
    return new Map(contracts.map(first => [first.discussionId, { first, comments: counts.get(first.discussionId) ?? 1 }]))
  }

  /** Only its author edits a comment; it says it was edited. */
  @UseCase('discussionComment.edit')
  async edit(workspaceId: string, commentId: string, input: DiscussionCommentInputDTO): Promise<DiscussionCommentDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const comment = await this.resolve(() => this.repo.find({ workspaceId, id: [commentId] }), () => new DiscussionCommentNotFound(commentId))
    comment.edit(currentActor().userId, DiscussionCommentInputSchema.parse(input).body)
    await this.repo.persist(comment)
    return (await this.contracts([comment]))[0]!
  }

  /** With the authors' nicks. */
  private async contracts(comments: DiscussionComment[]): Promise<DiscussionCommentDTO[]> {
    if (comments.length === 0) return []
    const dtos = comments.map(comment => comment.toDTO())
    const nicks = new Map((await this.deps.user.find({ id: [...new Set(dtos.map(dto => dto.authorId))] })).map(user => [user.id, user.nick]))
    return dtos.map(({ workspaceId: _, authorId, ...dto }) => ({ ...dto, author: { id: authorId, nick: nicks.get(authorId) ?? '' } }))
  }
}
