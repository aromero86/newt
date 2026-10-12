import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { ProposalExtracting } from './errors/proposal-extracting'
import { ProposalExtractionFailed } from './errors/proposal-extraction-failed'
import { ProposalFrozen } from './errors/proposal-frozen'
import { Proposal_Changed } from './events/proposal-changed'
import { Proposal_ExtractionRequested } from './events/proposal-extraction-requested'
import { ProposalNotInReview } from './errors/proposal-not-in-review'
import { ProposalTransitionNotAllowed } from './errors/proposal-transition-not-allowed'
import { RevisionNotFailed } from './errors/revision-not-failed'
import { ProposalExtractionSchema, ProposalExtractionStateSchema, ProposalStatusSchema, type ProposalExtractionDTO, type ProposalStatus } from './proposal.schema'

export * from './proposal.schema'

const ProposalEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  number: z.number().int().min(1),
  title: z.string(),
  status: ProposalStatusSchema,
  quick: z.boolean(),
  createdBy: z.uuidv7(),
  acceptedBy: z.uuidv7().nullable(),
  acceptedAt: z.string().nullable(),
  mergedBy: z.uuidv7().nullable(),
  mergedAt: z.string().nullable(),
  discardedBy: z.uuidv7().nullable(),
  discardedAt: z.string().nullable(),
  /** The working copy of its document. */
  document: z.string(),
  /** The last revision published; 0 while none is. */
  revision: z.number().int().min(0),
  /** How the extraction of the last revision stands; null while none is published. */
  extraction: ProposalExtractionSchema.nullable(),
  /** What the extraction of the last revision did, once it ends: written once, on that revision. */
  extracted: z.object({
    added: z.number(),
    changed: z.number(),
    removed: z.number(),
    questions: z.array(z.object({ question: z.string(), sources: z.array(z.string()) })),
  }).nullable().default(null),
  /** The revision being published; written once, with the proposal. */
  newRevision: z.object({
    number: z.number().int().min(1),
    message: z.string(),
    document: z.string(),
    publishedBy: z.uuidv7(),
    publishedAt: z.string(),
    added: z.number(),
    changed: z.number(),
    removed: z.number(),
    documentChanged: z.boolean(),
    assistant: z.string().nullable(),
    questions: z.array(z.object({ question: z.string(), sources: z.array(z.string()) })),
    extraction: ProposalExtractionStateSchema,
    extractionError: z.string().nullable(),
  }).nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type ProposalEntityDTO = z.infer<typeof ProposalEntitySchema>

/** Where each state can go. merged and discarded go nowhere. */
const NEXT: Record<ProposalStatus, ProposalStatus[]> = {
  'draft': ['in review', 'discarded'],
  'in review': ['draft', 'accepted', 'discarded'],
  'accepted': ['in review', 'merged', 'discarded'],
  'merged': [],
  'discarded': [],
}

/** A change to a product's definition, made of deltas, with its lifecycle. */
export class Proposal extends Entity<typeof ProposalEntitySchema> {

  private constructor(input: EntityInput<ProposalEntityDTO>, isNew: boolean) {
    super(ProposalEntitySchema, input, isNew)
  }

  static fromDTO(dto: ProposalEntityDTO): Proposal {
    return new Proposal(dto, false)
  }

  static create(input: { workspaceId: string, number: number, title: string, quick: boolean, createdBy: string }): Proposal {
    return new Proposal({
      ...input,
      status: input.quick ? 'in review' : 'draft',
      acceptedBy: null,
      acceptedAt: null,
      mergedBy: null,
      mergedAt: null,
      discardedBy: null,
      discardedAt: null,
      document: '',
      revision: 0,
      extraction: null,
      extracted: null,
      newRevision: null,
    }, true)
  }

  static keyOf(number: number): string {
    return `PROP-${number}`
  }

  get key(): string {
    return Proposal.keyOf(this.data.number)
  }

  get status(): ProposalStatus {
    return this.data.status
  }

  get document(): string {
    return this.data.document
  }

  get revision(): number {
    return this.data.revision
  }

  get extraction(): ProposalExtractionDTO | null {
    return this.data.extraction
  }

  /** Whether this revision is the last one and still waits for its deltas. */
  awaitsExtraction(revision: number): boolean {
    return this.data.revision === revision && this.data.extraction?.state === 'extracting'
  }

  /** Deltas and title change while it is a draft or in review. */
  assertEditable(what: string): void {
    if (this.data.status !== 'draft' && this.data.status !== 'in review') throw new ProposalFrozen(this.data.status, what)
  }

  assertInReview(): void {
    if (this.data.status !== 'in review') throw new ProposalNotInReview()
  }

  /** Its deltas are reviewed while it is in review and its last revision has them all. */
  assertReviewable(): void {
    this.assertInReview()
    this.assertExtracted('review its deltas')
  }

  /** Its last revision has its deltas: none is being extracted, and none failed to be. */
  assertExtracted(what: string): void {
    const state = this.data.extraction?.state
    if (state === 'extracting') throw new ProposalExtracting(this.data.revision, what)
    if (state === 'failed') throw new ProposalExtractionFailed(this.data.revision, what)
  }

  /**
   * One revision is extracted at a time: a new one waits until the last has its
   * deltas, since it is read against them. One that failed does not hold it back.
   */
  assertNotExtracting(what: string): void {
    if (this.data.extraction?.state === 'extracting') throw new ProposalExtracting(this.data.revision, what)
  }

  /** A save of the working copy: no revision, and reviewers do not see it. */
  writeDocument(document: string): void {
    this.assertEditable('change its document')
    this.change({ document })
  }

  /**
   * Publishes the working copy as the next revision, like a commit, deltas
   * included as they are written. `published` says what it did to the deltas;
   * `previous` is the last revision's document.
   */
  publish(input: { message: string, publishedBy: string, assistant: string | null, questions: { question: string, sources: string[] }[], previous: string, published: { added: number, changed: number, removed: number } }): number {
    return this.newRevision({ ...input, extraction: 'ready' })
  }

  /**
   * Publishes the working copy's document as the next revision, at once: its
   * deltas are extracted from it in the background, and reviewers wait for them.
   */
  publishForExtraction(input: { message: string, publishedBy: string, assistant: string | null, previous: string }): number {
    const number = this.newRevision({ ...input, questions: [], published: { added: 0, changed: 0, removed: 0 }, extraction: 'extracting' })
    this.trackEvent(new Proposal_ExtractionRequested({ workspaceId: this.data.workspaceId, proposalId: this.id, revision: number }))
    return number
  }

  /** The last revision has its deltas, published by now: what they did and what the document left open. */
  extractionEnded(result: { added: number, changed: number, removed: number, questions: { question: string, sources: string[] }[] }): void {
    this.change({ extraction: { state: 'ready', error: null }, extracted: result })
    this.changed()
  }

  extractionFailed(error: string): void {
    this.change({ extraction: { state: 'failed', error } })
    this.changed()
  }

  /** The last revision, whose extraction failed, is read again. */
  retryExtraction(): void {
    this.assertEditable('extract its deltas again')
    if (this.data.extraction?.state !== 'failed') throw new RevisionNotFailed()
    this.change({ extraction: { state: 'extracting', error: null } })
    this.trackEvent(new Proposal_ExtractionRequested({ workspaceId: this.data.workspaceId, proposalId: this.id, revision: this.data.revision }))
    this.changed()
  }

  private newRevision(input: { message: string, publishedBy: string, assistant: string | null, questions: { question: string, sources: string[] }[], previous: string, published: { added: number, changed: number, removed: number }, extraction: 'ready' | 'extracting' }): number {
    this.assertEditable('publish a revision')
    this.assertNotExtracting('publish another revision')
    const number = this.data.revision + 1
    this.change({
      revision: number,
      extraction: { state: input.extraction, error: null },
      newRevision: {
        number,
        message: input.message,
        document: this.data.document,
        publishedBy: input.publishedBy,
        assistant: input.assistant,
        questions: input.questions,
        publishedAt: new Date().toISOString(),
        ...input.published,
        documentChanged: this.data.document !== input.previous,
        extraction: input.extraction,
        extractionError: null,
      },
    })
    this.changed()
    return number
  }

  /** The working copy of the document goes back to the last revision's. */
  discardDocument(previous: string): void {
    this.assertEditable('discard its changes')
    this.change({ document: previous })
  }

  retitle(title: string): void {
    this.assertEditable('change its title')
    this.change({ title })
    this.changed()
  }

  /** To another state, if the lifecycle allows it, noting who took it there. */
  moveTo(status: ProposalStatus, userId: string): void {
    if (!NEXT[this.data.status].includes(status)) throw new ProposalTransitionNotAllowed(this.data.status, status)
    // Reviewed, accepted and merged is always what a revision's deltas say: never while they are missing.
    if (status === 'in review' || status === 'accepted' || status === 'merged') this.assertExtracted(status === 'in review' ? 'send it to review' : status === 'accepted' ? 'accept it' : 'merge it')
    const at = new Date().toISOString()
    this.change({
      status,
      ...(status === 'accepted' ? { acceptedBy: userId, acceptedAt: at } : {}),
      ...(status === 'merged' ? { mergedBy: userId, mergedAt: at } : {}),
      ...(status === 'discarded' ? { discardedBy: userId, discardedAt: at } : {}),
    })
    this.changed()
  }

  private changed(): void {
    this.trackEvent(new Proposal_Changed({ workspaceId: this.data.workspaceId, proposalId: this.id }))
  }
}
