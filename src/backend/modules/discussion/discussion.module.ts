import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import type { DiscussionCommentDTO, DiscussionCommentInputDTO } from '../discussion-comment/discussion-comment.schema'
import { Discussion, DiscussionStartSchema, type DiscussionCounts, type DiscussionDTO, type DiscussionStartDTO } from './discussion'
import type { Discussion_Deps } from './discussion.deps'
import { Discussion_Repository } from './discussion.repository'
import { registerDiscussionRoutes } from './discussion.routes'
import { DiscussionNotFound } from './errors/discussion-not-found'

/**
 * The conversations on each proposal: on it in general or on one of its deltas.
 * Any member starts one, replies or resolves it. One stays when its delta changes
 * or goes, saying which revision it was about. What is said lives in the
 * discussion-comment module.
 */
export class Discussion_Module extends Module {

  static async initialize(base: Base, deps: Discussion_Deps) {
    const module = new Discussion_Module(base, new Discussion_Repository(base), deps)
    registerDiscussionRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: Discussion_Repository, private readonly deps: Discussion_Deps) {
    super('discussion', base.transactions)
  }

  /** A page of the conversations on a proposal (`deltaId` null) or on one of its deltas, oldest first. */
  @UseCase('discussion.list')
  async list(workspaceId: string, key: string, deltaId: string | null, page: PageRequest): Promise<Page<DiscussionDTO>> {
    const proposal = await this.deps.proposal.get(workspaceId, key)
    const discussions = await this.repo.page({ proposalId: proposal.id, deltaId }, page)
    return { ...discussions, items: await this.contracts(discussions.items) }
  }

  /** How many conversations each delta has, and the proposal in general (under ''), and how many are open. */
  @UseCase('discussion.counts')
  async counts(workspaceId: string, key: string): Promise<Record<string, DiscussionCounts>> {
    const proposal = await this.deps.proposal.get(workspaceId, key)
    return Object.fromEntries(await this.repo.counts({ proposalId: proposal.id }))
  }

  /** A new conversation on the proposal or one of its deltas, with its first comment. */
  @UseCase('discussion.start')
  async start(workspaceId: string, key: string, input: DiscussionStartDTO): Promise<DiscussionDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { body, deltaId } = DiscussionStartSchema.parse(input)
    const proposal = await this.deps.proposal.get(workspaceId, key)
    if (deltaId) await this.deps.proposal.assertDelta(workspaceId, key, deltaId)

    const discussion = Discussion.start({ workspaceId, proposalId: proposal.id, deltaId: deltaId ?? null, revision: proposal.revision, startedBy: currentActor().userId })
    await this.repo.persist(discussion)
    await this.deps.discussionComment.add(workspaceId, discussion.id, { body })
    return (await this.contracts([discussion]))[0]!
  }

  /** A page of what was said in a conversation, oldest first. */
  @UseCase('discussion.comments')
  async comments(workspaceId: string, discussionId: string, page: PageRequest): Promise<Page<DiscussionCommentDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return this.deps.discussionComment.list((await this.load(workspaceId, discussionId)).id, page)
  }

  @UseCase('discussion.reply')
  async reply(workspaceId: string, discussionId: string, input: DiscussionCommentInputDTO): Promise<DiscussionCommentDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    return this.deps.discussionComment.add(workspaceId, (await this.load(workspaceId, discussionId)).id, input)
  }

  @UseCase('discussion.resolveDiscussion')
  async resolveDiscussion(workspaceId: string, discussionId: string): Promise<DiscussionDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const discussion = await this.load(workspaceId, discussionId)
    discussion.resolveBy(currentActor().userId)
    await this.repo.persist(discussion)
    return (await this.contracts([discussion]))[0]!
  }

  @UseCase('discussion.reopen')
  async reopen(workspaceId: string, discussionId: string): Promise<DiscussionDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const discussion = await this.load(workspaceId, discussionId)
    discussion.reopen()
    await this.repo.persist(discussion)
    return (await this.contracts([discussion]))[0]!
  }

  private load(workspaceId: string, discussionId: string): Promise<Discussion> {
    return this.resolve(() => this.repo.find({ workspaceId, id: [discussionId] }), () => new DiscussionNotFound(discussionId))
  }

  /** With the people's nicks, the comment that started each and how many each has. */
  private async contracts(discussions: Discussion[]): Promise<DiscussionDTO[]> {
    if (discussions.length === 0) return []
    const dtos = discussions.map(discussion => discussion.toDTO())
    const userIds = [...new Set(dtos.flatMap(dto => [dto.startedBy, dto.resolvedBy]).filter(id => id !== null))]
    const nicks = new Map((await this.deps.user.find({ id: userIds })).map(user => [user.id, user.nick]))
    const summaries = await this.deps.discussionComment.summaries(dtos.map(dto => dto.id))

    return dtos.map(({ workspaceId: _, startedBy, resolvedBy, ...dto }) => ({
      ...dto,
      startedBy: { id: startedBy, nick: nicks.get(startedBy) ?? '' },
      resolvedBy: resolvedBy === null ? null : { id: resolvedBy, nick: nicks.get(resolvedBy) ?? '' },
      first: summaries.get(dto.id)!.first,
      comments: summaries.get(dto.id)!.comments,
    }))
  }
}
