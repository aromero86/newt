import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { ProposalFrozen } from './errors/proposal-frozen'
import { Proposal_Changed } from './events/proposal-changed'
import { ProposalNotInReview } from './errors/proposal-not-in-review'
import { ProposalTransitionNotAllowed } from './errors/proposal-transition-not-allowed'
import { ProposalStatusSchema, type ProposalStatus } from './proposal.schema'

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

  /** Deltas and title change while it is a draft or in review. */
  assertEditable(what: string): void {
    if (this.data.status !== 'draft' && this.data.status !== 'in review') throw new ProposalFrozen(this.data.status, what)
  }

  assertInReview(): void {
    if (this.data.status !== 'in review') throw new ProposalNotInReview()
  }

  /** A save of the working copy: no revision, and reviewers do not see it. */
  writeDocument(document: string): void {
    this.assertEditable('change its document')
    this.change({ document })
  }

  /**
   * Publishes the working copy as the next revision, like a commit. `published`
   * says what it did to the deltas; `previous` is the last revision's document.
   */
  publish(input: { message: string, publishedBy: string, assistant: string | null, previous: string, published: { added: number, changed: number, removed: number } }): number {
    this.assertEditable('publish a revision')
    const number = this.data.revision + 1
    this.change({
      revision: number,
      newRevision: {
        number,
        message: input.message,
        document: this.data.document,
        publishedBy: input.publishedBy,
        assistant: input.assistant,
        publishedAt: new Date().toISOString(),
        ...input.published,
        documentChanged: this.data.document !== input.previous,
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
