import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import type { DeltaDTO, DeltaInputDTO, DeltaReviewInputDTO } from '../delta/delta.schema'
import { ProposalNotFound } from './errors/proposal-not-found'
import {
  Proposal,
  ProposalCreateSchema,
  ProposalQuickSchema,
  ProposalUpdateSchema,
  type ProposalCreateDTO,
  type ProposalDTO,
  type ProposalQuickDTO,
  type ProposalStatus,
  type ProposalUpdateDTO,
} from './proposal'
import type { Proposal_Deps } from './proposal.deps'
import { Proposal_Repository } from './proposal.repository'
import { registerProposalRoutes } from './proposal.routes'

/**
 * Proposals: every change to a workspace's definition, delta by delta, and their
 * lifecycle. Any member takes part. Their deltas live in the delta module; this one
 * decides when they may be written, reviewed, accepted and merged.
 */
export class Proposal_Module extends Module {

  static async initialize(base: Base, deps: Proposal_Deps) {
    const module = new Proposal_Module(base, new Proposal_Repository(base), deps)
    registerProposalRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: Proposal_Repository, private readonly deps: Proposal_Deps) {
    super('proposal', base.transactions)
  }

  /** A page of the workspace's proposals, newest first, in any of these states. */
  @UseCase('proposal.list')
  async list(workspaceId: string, status: ProposalStatus[] | undefined, page: PageRequest): Promise<Page<ProposalDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const proposals = await this.repo.page(workspaceId, status, page)
    return { ...proposals, items: await this.contracts(proposals.items) }
  }

  @UseCase('proposal.get')
  async get(workspaceId: string, key: string): Promise<ProposalDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return (await this.contracts([await this.load(workspaceId, key)]))[0]!
  }

  /** A draft, to add deltas to. */
  @UseCase('proposal.create')
  async create(workspaceId: string, input: ProposalCreateDTO): Promise<ProposalDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { title } = ProposalCreateSchema.parse(input)
    const proposal = Proposal.create({ workspaceId, number: await this.repo.nextNumber(workspaceId), title, quick: false, createdBy: currentActor().userId })
    await this.repo.persist(proposal)
    return (await this.contracts([proposal]))[0]!
  }

  /** One change made in place: a proposal in review with that single delta, and a title written for it. */
  @UseCase('proposal.quick')
  async quick(workspaceId: string, input: ProposalQuickDTO): Promise<ProposalDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { delta } = ProposalQuickSchema.parse(input)
    const proposal = Proposal.create({ workspaceId, number: await this.repo.nextNumber(workspaceId), title: 'Change the definition', quick: true, createdBy: currentActor().userId })
    await this.repo.persist(proposal)

    await this.deps.delta.add(workspaceId, proposal.id, delta)
    const saved = await this.load(workspaceId, proposal.key)
    saved.retitle(await this.deps.delta.describe(proposal.id))
    await this.repo.persist(saved)
    return (await this.contracts([saved]))[0]!
  }

  @UseCase('proposal.update')
  async update(workspaceId: string, key: string, input: ProposalUpdateDTO): Promise<ProposalDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.retitle(ProposalUpdateSchema.parse(input).title)
    await this.repo.persist(proposal)
    return (await this.contracts([proposal]))[0]!
  }

  /** Ready to decide: draft → in review. */
  @UseCase('proposal.submit')
  async submit(workspaceId: string, key: string): Promise<ProposalDTO> {
    return this.moveTo(workspaceId, key, 'in review')
  }

  /** Back to work: in review → draft. */
  @UseCase('proposal.backToDraft')
  async backToDraft(workspaceId: string, key: string): Promise<ProposalDTO> {
    return this.moveTo(workspaceId, key, 'draft')
  }

  /** Every delta approved: it becomes the brief for development, frozen. */
  @UseCase('proposal.accept')
  async accept(workspaceId: string, key: string): Promise<ProposalDTO> {
    const proposal = await this.writable(workspaceId, key)
    await this.deps.delta.assertReady(workspaceId, proposal.id)
    return this.moveProposal(proposal, 'accepted')
  }

  /** Something could not be built that way: accepted → in review, approvals kept. */
  @UseCase('proposal.reopen')
  async reopen(workspaceId: string, key: string): Promise<ProposalDTO> {
    return this.moveTo(workspaceId, key, 'in review')
  }

  /** Its code is in: every delta enters the definition in force, all at once. */
  @UseCase('proposal.merge')
  async merge(workspaceId: string, key: string): Promise<ProposalDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.moveTo('merged', currentActor().userId)
    await this.deps.delta.apply(workspaceId, proposal.id)
    await this.repo.persist(proposal)
    return (await this.contracts([proposal]))[0]!
  }

  @UseCase('proposal.discard')
  async discard(workspaceId: string, key: string): Promise<ProposalDTO> {
    return this.moveTo(workspaceId, key, 'discarded')
  }

  /** A page of its deltas, in the order they will be applied. */
  @UseCase('proposal.deltas')
  async deltas(workspaceId: string, key: string, page: PageRequest): Promise<Page<DeltaDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const proposal = await this.load(workspaceId, key)
    return this.deps.delta.list(workspaceId, proposal.id, page)
  }

  @UseCase('proposal.addDelta')
  async addDelta(workspaceId: string, key: string, input: DeltaInputDTO): Promise<DeltaDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertEditable('change its deltas')
    return this.deps.delta.add(workspaceId, proposal.id, input)
  }

  @UseCase('proposal.rewriteDelta')
  async rewriteDelta(workspaceId: string, key: string, deltaId: string, input: DeltaInputDTO): Promise<DeltaDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertEditable('change its deltas')
    return this.deps.delta.rewrite(workspaceId, proposal.id, deltaId, input)
  }

  @UseCase('proposal.removeDelta')
  async removeDelta(workspaceId: string, key: string, deltaId: string): Promise<void> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertEditable('change its deltas')
    await this.deps.delta.remove(proposal.id, deltaId)
  }

  /** The signed-in person approves or rejects a delta, while the proposal is in review. */
  @UseCase('proposal.reviewDelta')
  async reviewDelta(workspaceId: string, key: string, deltaId: string, input: DeltaReviewInputDTO): Promise<DeltaDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertInReview()
    return this.deps.delta.review(workspaceId, proposal.id, deltaId, input)
  }

  @UseCase('proposal.withdrawReview')
  async withdrawReview(workspaceId: string, key: string, deltaId: string): Promise<DeltaDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertInReview()
    return this.deps.delta.withdraw(workspaceId, proposal.id, deltaId)
  }

  private async moveTo(workspaceId: string, key: string, status: ProposalStatus): Promise<ProposalDTO> {
    return this.moveProposal(await this.writable(workspaceId, key), status)
  }

  private async moveProposal(proposal: Proposal, status: ProposalStatus): Promise<ProposalDTO> {
    proposal.moveTo(status, currentActor().userId)
    await this.repo.persist(proposal)
    return (await this.contracts([proposal]))[0]!
  }

  /** A proposal of a workspace its member may change. */
  private async writable(workspaceId: string, key: string): Promise<Proposal> {
    await this.deps.workspace.assertWritable(workspaceId)
    return this.load(workspaceId, key)
  }

  private load(workspaceId: string, key: string): Promise<Proposal> {
    const number = Number.parseInt(key.replace(/^PROP-/i, ''), 10)
    if (!Number.isInteger(number)) throw new ProposalNotFound(key)
    return this.resolve(() => this.repo.find({ workspaceId, number }), () => new ProposalNotFound(key))
  }

  /** With the people's nicks and how many deltas are in each state. */
  private async contracts(proposals: Proposal[]): Promise<ProposalDTO[]> {
    if (proposals.length === 0) return []
    const dtos = proposals.map(proposal => proposal.toDTO())
    const userIds = [...new Set(dtos.flatMap(dto => [dto.createdBy, dto.acceptedBy, dto.mergedBy, dto.discardedBy]).filter(id => id !== null))]
    const nicks = new Map((await this.deps.user.find({ id: userIds })).map(user => [user.id, user.nick]))
    const person = (id: string | null) => (id === null ? null : { id, nick: nicks.get(id) ?? '' })
    const counts = await this.deps.delta.counts(dtos.map(dto => dto.id))

    return dtos.map(dto => ({
      ...dto,
      key: Proposal.keyOf(dto.number),
      createdBy: person(dto.createdBy)!,
      acceptedBy: person(dto.acceptedBy),
      mergedBy: person(dto.mergedBy),
      discardedBy: person(dto.discardedBy),
      deltas: counts.get(dto.id) ?? { total: 0, approved: 0, rejected: 0, pending: 0 },
    }))
  }
}
