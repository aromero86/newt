import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { DomainEventEmitter } from '../../core/events/domain-event-emitter'
import { DomainError } from '../../core/errors/domain-error'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { DeltaNotFound } from '../delta/errors/delta-not-found'
import type { ExtractionDTO, ExtractionQuestionDTO } from '../extraction/extraction.schema'
import type { DeltaComparisonDTO, DeltaDTO, DeltaInputDTO, DeltaReviewInputDTO, DeltaSnapshotDTO, DeltaView } from '../delta/delta.schema'
import { NothingToPublish } from './errors/nothing-to-publish'
import { ProposalDocumentChanged } from './errors/proposal-document-changed'
import { ProposalFrozen } from './errors/proposal-frozen'
import { ProposalChangedSince } from './errors/proposal-changed-since'
import { Proposal_Changed } from './events/proposal-changed'
import { ProposalUnpublished } from './errors/proposal-unpublished'
import { RevisionNotFound } from './errors/revision-not-found'
import { ProposalNotFound } from './errors/proposal-not-found'
import {
  Proposal,
  ProposalCreateSchema,
  ProposalDocumentInputSchema,
  ProposalIterateSchema,
  ProposalWriteSchema,
  ProposalPublishSchema,
  ProposalQuickSchema,
  ProposalSubmitSchema,
  ProposalUpdateSchema,
  type ProposalCreateDTO,
  type ProposalDocumentInputDTO,
  type ProposalDTO,
  type ProposalIterateDTO,
  type ProposalWriteDTO,
  type ProposalPublishDTO,
  type ProposalQuickDTO,
  type ProposalRevisionDTO,
  type ProposalSubmitDTO,
  type ProposalStatus,
  type ProposalUpdateDTO,
} from './proposal'
import type { Proposal_Deps } from './proposal.deps'
import { Proposal_Repository, type Proposal_Criteria, type ProposalRevisionRow } from './proposal.repository'
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

  /** A proposal published a revision, was retitled or changed state. */
  readonly changed

  private constructor(base: Base, private readonly repo: Proposal_Repository, private readonly deps: Proposal_Deps) {
    super('proposal', base.transactions)
    this.changed = new DomainEventEmitter(base.bus, Proposal_Changed)
  }

  /** A page of the workspace's proposals, newest first, in any of these states and with these words in their title. */
  @UseCase('proposal.list')
  async list(workspaceId: string, filter: { status?: ProposalStatus[], title?: string }, page: PageRequest): Promise<Page<ProposalDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const proposals = await this.repo.page({ ...filter, workspaceId }, page)
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

  /**
   * A draft written whole, as an assistant writes it: its document, read for its
   * deltas, published at once as its first revision. Not a use case: it waits for
   * the extraction, holding no transaction meanwhile.
   */
  async write(workspaceId: string, input: ProposalWriteDTO): Promise<ProposalDTO> {
    const { title, message, document } = ProposalWriteSchema.parse(input)
    await this.deps.workspace.assertWritable(workspaceId)
    const extraction = await this.deps.extraction.extract(workspaceId, document, [])
    return this.writeExtracted(workspaceId, { title, message, document, extraction })
  }

  @UseCase('proposal.writeExtracted')
  async writeExtracted(workspaceId: string, input: { title: string, message: string, document: string, extraction: ExtractionDTO }): Promise<ProposalDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const proposal = Proposal.create({ workspaceId, number: await this.repo.nextNumber(workspaceId), title: input.title, quick: false, createdBy: currentActor().userId })
    await this.repo.persist(proposal)
    return this.commitRevision(workspaceId, proposal.key, { basedOn: 0, read: '', document: input.document, message: input.message, extraction: input.extraction })
  }

  /**
   * The next revision, with the deltas extracted from its document: the working
   * copy's, or a whole new one with its title, as an assistant iterates. With
   * `basedOn`, it is refused if another revision came after that one, or if the
   * working copy has changes nobody published: nobody's work is overwritten
   * without them noticing. Not a use case: it waits for the extraction.
   */
  async revise(workspaceId: string, key: string, input: ProposalIterateDTO | { message: string }): Promise<ProposalDTO> {
    const { basedOn, message, title, document } = 'basedOn' in input ? ProposalIterateSchema.parse(input) : { ...ProposalPublishSchema.parse(input), basedOn: undefined, title: undefined, document: undefined }
    const proposal = await this.get(workspaceId, key)
    if (proposal.status !== 'draft' && proposal.status !== 'in review') throw new ProposalFrozen(proposal.status, 'take new revisions')
    if (basedOn !== undefined && proposal.revision !== basedOn) throw new ProposalChangedSince(basedOn, proposal.revision)
    if (document !== undefined && proposal.unpublished) throw new ProposalUnpublished()
    const next = document ?? proposal.document
    // Nothing new to read: spare the extraction.
    if (proposal.revision > 0 && title === undefined && !proposal.unpublished && next === proposal.document) throw new NothingToPublish()

    const previous = (await this.allDeltas(workspaceId, key)).filter(delta => !delta.removed)
    const extraction = await this.deps.extraction.extract(workspaceId, next, previous)
    return this.commitRevision(workspaceId, key, { basedOn: proposal.revision, read: proposal.document, title, document: next, message, extraction })
  }

  /** As an assistant iterates: `revise` with the revision it read. */
  async iterate(workspaceId: string, key: string, input: ProposalIterateDTO): Promise<ProposalDTO> {
    return this.revise(workspaceId, key, ProposalIterateSchema.parse(input))
  }

  /** Publishes the working copy as the next revision, like a commit, with the deltas extracted from its document. */
  async publish(workspaceId: string, key: string, input: ProposalPublishDTO): Promise<ProposalDTO> {
    return this.revise(workspaceId, key, input)
  }

  /** Ready to decide: draft → in review. Changes not published yet go first in a revision with this message. */
  async sendToReview(workspaceId: string, key: string, input: ProposalSubmitDTO): Promise<ProposalDTO> {
    const { message } = ProposalSubmitSchema.parse(input)
    const proposal = await this.get(workspaceId, key)
    if (proposal.revision === 0 || proposal.unpublished) await this.revise(workspaceId, key, { message: message ?? '' })
    return this.submit(workspaceId, key, {})
  }

  /**
   * Writes what the extraction read as the next revision, if the proposal is as it
   * was when it was read: same revision, same working document.
   */
  @UseCase('proposal.commitRevision')
  async commitRevision(workspaceId: string, key: string, input: { basedOn: number, read: string, document: string, title?: string, message: string, extraction: ExtractionDTO }): Promise<ProposalDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertEditable('take new revisions')
    if (proposal.revision !== input.basedOn) throw new ProposalChangedSince(input.basedOn, proposal.revision)
    if (proposal.document !== input.read) throw new ProposalDocumentChanged()
    if (input.title !== undefined) proposal.retitle(input.title)
    if (input.document !== proposal.document) proposal.writeDocument(input.document)

    // The deltas follow the document: the same ones rewritten (and kept, if they mean
    // the same), new ones added, and the ones it no longer supports removed.
    const current = (await this.allDeltas(workspaceId, key, 'working')).filter(delta => !delta.removed)
    const same = (previousId: string | null, delta: DeltaInputDTO) => current.find(each => each.id === previousId && each.kind === delta.kind && each.operation === delta.operation)
    const kept = new Set(input.extraction.deltas.map(({ previousId, input: delta }) => same(previousId, delta)?.id).filter(id => id !== undefined))
    for (const delta of current) if (!kept.has(delta.id)) await this.deps.delta.remove(proposal.id, delta.id)

    const questions = [...input.extraction.questions]
    const refs = new Map<string, string>()
    const resolveRefs = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith('ref:')) return refs.get(value.slice(4)) ?? value
      if (Array.isArray(value)) return value.map(resolveRefs)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, each]) => [field, resolveRefs(each)]))
      return value
    }
    for (const { previousId, ref, input: delta } of input.extraction.deltas) {
      try {
        const previous = same(previousId, delta)
        const written = previous
          ? await this.deps.delta.rewrite(workspaceId, proposal.id, previous.id, resolveRefs(delta) as DeltaInputDTO)
          : await this.deps.delta.add(workspaceId, proposal.id, resolveRefs(delta) as DeltaInputDTO)
        refs.set(ref, written.targetId)
      } catch (error) {
        if (!(error instanceof DomainError)) throw error
        questions.push({ question: `A change could not be written as a delta: ${error.message}.`, sources: delta.sources ?? [] })
      }
    }

    // A new title alone is no revision: revisions publish the document and the deltas.
    const changed = proposal.revision === 0 || (await this.hasUnpublished(proposal))
    if (!changed && input.title === undefined) throw new NothingToPublish()
    if (changed) await this.publishWorkingCopy(proposal, input.message, questions)
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

    const added = await this.deps.delta.add(workspaceId, proposal.id, delta)
    const saved = await this.load(workspaceId, proposal.key)
    saved.retitle(await this.deps.delta.describe(proposal.id))
    // The document stays the source: it says what the delta does.
    saved.writeDocument(briefOf(saved.toDTO().title, added))
    await this.publishWorkingCopy(saved, 'Proposed from the definition')
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

  /** A save of the working copy of the document: no revision, and reviewers do not see it. */
  @UseCase('proposal.writeDocument')
  async writeDocument(workspaceId: string, key: string, input: ProposalDocumentInputDTO): Promise<ProposalDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.writeDocument(ProposalDocumentInputSchema.parse(input).document)
    await this.repo.persist(proposal)
    return (await this.contracts([proposal]))[0]!
  }

  /**
   * Publishes the working copy as it is written, deltas included, without reading
   * the document: for scripts that write deltas themselves, such as the seed.
   */
  @UseCase('proposal.publishAsWritten')
  async publishAsWritten(workspaceId: string, key: string, input: ProposalPublishDTO): Promise<ProposalDTO> {
    const { message } = ProposalPublishSchema.parse(input)
    const proposal = await this.writable(workspaceId, key)
    if (proposal.revision > 0 && !(await this.hasUnpublished(proposal))) throw new NothingToPublish()
    await this.publishWorkingCopy(proposal, message)
    await this.repo.persist(proposal)
    return (await this.contracts([proposal]))[0]!
  }

  /** The working copy, document and deltas, goes back to the last revision. */
  @UseCase('proposal.discardChanges')
  async discardChanges(workspaceId: string, key: string): Promise<ProposalDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.discardDocument(await this.publishedDocument(proposal))
    await this.deps.delta.discard(proposal.id)
    await this.repo.persist(proposal)
    return (await this.contracts([proposal]))[0]!
  }

  /** Draft → in review. Changes not published yet go as written in a revision with this message: `sendToReview` reads the document first. */
  @UseCase('proposal.submit')
  async submit(workspaceId: string, key: string, input: ProposalSubmitDTO): Promise<ProposalDTO> {
    const { message } = ProposalSubmitSchema.parse(input)
    const proposal = await this.writable(workspaceId, key)
    if (proposal.revision === 0 || (await this.hasUnpublished(proposal))) {
      await this.publishWorkingCopy(proposal, ProposalPublishSchema.parse({ message }).message)
    }
    return this.moveProposal(proposal, 'in review')
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
    if (await this.hasUnpublished(proposal)) throw new ProposalUnpublished()
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

  /** For other modules: the workspace's proposals that match. */
  @UseCase('proposal.find')
  async find(workspaceId: string, criteria: Omit<Proposal_Criteria, 'workspaceId'>): Promise<ProposalDTO[]> {
    return this.contracts(await this.repo.find({ ...criteria, workspaceId }))
  }

  /**
   * A page of its deltas, in the order they will be applied: as the last revision
   * published them, what reviewers see, or as they are being written.
   */
  @UseCase('proposal.deltas')
  async deltas(workspaceId: string, key: string, view: DeltaView, page: PageRequest): Promise<Page<DeltaDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const proposal = await this.load(workspaceId, key)
    return this.deps.delta.list(workspaceId, { proposalId: [proposal.id] }, view, page)
  }

  /** A page of its revisions, newest first. */
  @UseCase('proposal.revisions')
  async revisions(workspaceId: string, key: string, page: PageRequest): Promise<Page<ProposalRevisionDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const revisions = await this.repo.revisions((await this.load(workspaceId, key)).id, page)
    return { ...revisions, items: await this.revisionContracts(revisions.items) }
  }

  @UseCase('proposal.revision')
  async revision(workspaceId: string, key: string, number: number): Promise<ProposalRevisionDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const row = await this.repo.revision((await this.load(workspaceId, key)).id, number)
    if (!row) throw new RevisionNotFound(number)
    return (await this.revisionContracts([row]))[0]!
  }

  /** A page of what a revision did to the deltas. */
  @UseCase('proposal.revisionDeltas')
  async revisionDeltas(workspaceId: string, key: string, number: number, page: PageRequest): Promise<Page<DeltaSnapshotDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return this.deps.delta.snapshots((await this.load(workspaceId, key)).id, number, page)
  }

  /** A page of the deltas of two revisions, with what each said in one and in the other. */
  @UseCase('proposal.compare')
  async compare(workspaceId: string, key: string, from: number, to: number, page: PageRequest): Promise<Page<DeltaComparisonDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return this.deps.delta.compare((await this.load(workspaceId, key)).id, from, to, page)
  }

  /** A delta written by hand: only scripts that write a proposal's history, such as the seed. People's deltas come from the document. */
  @UseCase('proposal.addDelta')
  async addDelta(workspaceId: string, key: string, input: DeltaInputDTO): Promise<DeltaDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertEditable('change its deltas')
    return this.deps.delta.add(workspaceId, proposal.id, input)
  }

  /** For scripts, as `addDelta`. */
  @UseCase('proposal.rewriteDelta')
  async rewriteDelta(workspaceId: string, key: string, deltaId: string, input: DeltaInputDTO): Promise<DeltaDTO> {
    const proposal = await this.writable(workspaceId, key)
    proposal.assertEditable('change its deltas')
    return this.deps.delta.rewrite(workspaceId, proposal.id, deltaId, input)
  }

  /** For other modules: a delta of the proposal that has not gone. */
  @UseCase('proposal.assertDelta')
  async assertDelta(workspaceId: string, key: string, deltaId: string): Promise<void> {
    const proposal = await this.load(workspaceId, key)
    const { items } = await this.deps.delta.list(workspaceId, { proposalId: [proposal.id], id: [deltaId] }, 'working', { size: 1 })
    if (items.length === 0) throw new DeltaNotFound(deltaId)
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

  /**
   * The working copy as the next revision: the deltas publish theirs now; the
   * proposal's is written when the caller saves it, once.
   */
  private async publishWorkingCopy(proposal: Proposal, message: string, questions: ExtractionQuestionDTO[] = []): Promise<void> {
    const previous = await this.publishedDocument(proposal)
    const published = await this.deps.delta.publish(proposal.id, proposal.revision + 1)
    const { userId, assistant } = currentActor()
    proposal.publish({ message, publishedBy: userId, assistant: assistant ?? null, questions, previous, published })
  }

  /** Every delta of a proposal, page after page. */
  private async allDeltas(workspaceId: string, key: string, view: DeltaView = 'working'): Promise<DeltaDTO[]> {
    const proposal = await this.load(workspaceId, key)
    const deltas: DeltaDTO[] = []
    for (let cursor: string | undefined, more = true; more;) {
      const page = await this.deps.delta.list(workspaceId, { proposalId: [proposal.id] }, view, { size: 100, cursor })
      deltas.push(...page.items)
      cursor = page.items.at(-1)?.id
      more = page.hasMore
    }
    return deltas
  }

  /** The document or the deltas of the working copy differ from the last revision. */
  private async hasUnpublished(proposal: Proposal): Promise<boolean> {
    return proposal.document !== (await this.publishedDocument(proposal)) || this.deps.delta.hasUnpublished(proposal.id)
  }

  private async publishedDocument(proposal: Proposal): Promise<string> {
    return proposal.revision === 0 ? '' : ((await this.repo.revision(proposal.id, proposal.revision))?.document ?? '')
  }

  /** With the nick of who published each. */
  private async revisionContracts(rows: ProposalRevisionRow[]): Promise<ProposalRevisionDTO[]> {
    const nicks = new Map((await this.deps.user.find({ id: [...new Set(rows.map(row => row.publishedBy))] })).map(user => [user.id, user.nick]))
    return rows.map(({ proposalId: _, publishedBy, ...row }) => ({ ...row, id: String(row.number), publishedBy: { id: publishedBy, nick: nicks.get(publishedBy) ?? '' } }))
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

    const unpublished = new Map(await Promise.all(proposals.map(async proposal => [proposal.id, await this.hasUnpublished(proposal)] as const)))

    return dtos.map(({ newRevision: _, ...dto }) => ({
      ...dto,
      unpublished: unpublished.get(dto.id) ?? false,
      key: Proposal.keyOf(dto.number),
      createdBy: person(dto.createdBy)!,
      acceptedBy: person(dto.acceptedBy),
      mergedBy: person(dto.mergedBy),
      discardedBy: person(dto.discardedBy),
      deltas: counts.get(dto.id) ?? { total: 0, approved: 0, rejected: 0, pending: 0 },
    }))
  }
}

/** The document of a proposal made in place: what its one delta does. */
function briefOf(title: string, delta: DeltaDTO): string {
  const after = (delta.after ?? {}) as Record<string, unknown>
  const lines = [`# ${title}`, '', 'Proposed in place, from the definition.']
  if (typeof after.statement === 'string') lines.push('', after.statement, '', `Why: ${String(after.why ?? '')}`)
  else if (typeof after.name === 'string') lines.push('', after.name, ...(after.description ? ['', String(after.description)] : []))
  return lines.join('\n')
}
