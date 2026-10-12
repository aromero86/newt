import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Base } from '../../base/base'
import type { Actor } from '../../core/context/actor'
import { runAsActor } from '../../core/context/run-as-actor'
import { Delta_Module } from '../delta/delta.module'
import { Dimension_Module } from '../dimension/dimension.module'
import type { ExtractionAnswer } from '../extraction/extraction.schema'
import { Extraction_Module } from '../extraction/extraction.module'
import type { Llm } from '../extraction/infrastructure/llm'
import { FeatureArea_Module } from '../feature-area/feature-area.module'
import { Feature_Module } from '../feature/feature.module'
import { Rule_Module } from '../rule/rule.module'
import { User_Module } from '../user/user.module'
import { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import { Workspace_Module } from '../workspace/workspace.module'
import { ProposalExtracting } from './errors/proposal-extracting'
import { ProposalExtractionFailed } from './errors/proposal-extraction-failed'
import { ProposalNotInReview } from './errors/proposal-not-in-review'
import { RevisionNotFailed } from './errors/revision-not-failed'
import { Proposal_Module } from './proposal.module'

const DOCUMENT = 'Guests cannot pay more than 500 EUR per order.\n\nCustomers can save their cards.'

/** A language model that answers what the test says, when the test lets it. */
class StubLlm implements Llm {
  calls = 0
  /** What it answers next: an answer, or an error it throws. */
  reply: () => ExtractionAnswer = () => ({ deltas: [], questions: [] })
  private gate: Promise<void> = Promise.resolve()
  private open: () => void = () => {}

  /** Answers wait until `release`. */
  hold(): void {
    this.gate = new Promise(resolve => {
      this.open = resolve
    })
  }

  release(): void {
    this.open()
  }

  async answer(): Promise<unknown> {
    this.calls++
    await this.gate
    return this.reply()
  }
}

const rule = (ref: string, statement: string, featureId: string, source: string) => ({
  ref, previousId: null, kind: 'rule' as const, operation: 'create' as const, target: null, area: null, feature: featureId,
  name: null, description: null, ruleKind: 'permission' as const, statement, why: 'Because the business says so', scope: [], criteria: [], sources: [source],
})

let base: Base
let llm: StubLlm
let proposals: Proposal_Module
let workspace: Workspace_Module
let workspaceMember: WorkspaceMember_Module
let author: Actor
let reviewer: Actor
let stranger: Actor
let workspaceId: string
let featureId: string

const as = <T>(actor: Actor, fn: () => Promise<T>) => runAsActor(actor, fn)
/** Lets the workers that the last use case started end. */
const settle = async () => {
  await Bun.sleep(1)
  await proposals.idle()
}
const twoRules = () => ({
  deltas: [
    rule('d1', 'Guests cannot pay more than 500 EUR per order', featureId, 'Guests cannot pay more than 500 EUR per order.'),
    rule('d2', 'Customers can save their cards', featureId, 'Customers can save their cards.'),
  ],
  questions: [{ question: 'Does the limit apply in Mexico?', sources: ['Guests cannot pay more than 500 EUR per order.'] }],
})

beforeEach(async () => {
  base = await Base.open({ dbPath: ':memory:', migrationsFolder: join(import.meta.dir, '../../migrations') })
  llm = new StubLlm()
  const user = await User_Module.initialize(base)
  workspaceMember = await WorkspaceMember_Module.initialize(base, { user })
  workspace = await Workspace_Module.initialize(base, { workspaceMember })
  const dimension = await Dimension_Module.initialize(base, { workspace, workspaceMember })
  const featureArea = await FeatureArea_Module.initialize(base, { workspace, workspaceMember })
  const feature = await Feature_Module.initialize(base, { featureArea, workspace, workspaceMember })
  const ruleModule = await Rule_Module.initialize(base, { dimension, feature, workspace, workspaceMember })
  const delta = await Delta_Module.initialize(base, { dimension, feature, featureArea, rule: ruleModule, user })
  const extraction = await Extraction_Module.initialize(base, { dimension, feature, featureArea, rule: ruleModule, workspace }, { provider: 'claude-cli', model: '', apiKey: '' }, llm)
  proposals = await Proposal_Module.initialize(base, { delta, extraction, user, workspace, workspaceMember })

  const person = async (nick: string): Promise<Actor> => ({ userId: (await user.create({ nick, fullName: nick, email: `${nick}@newt.test` })).id, sessionId: null })
  author = await person('author')
  reviewer = await person('reviewer')
  stranger = await person('stranger')
  workspaceId = (await as(author, () => workspace.create({ name: 'Shop' }))).id
  await workspaceMember.join(workspaceId, reviewer.userId, 'member')
  const areaId = (await as(author, () => featureArea.create(workspaceId, { name: 'Purchase' }))).id
  featureId = (await as(author, () => feature.create(workspaceId, { areaId, name: 'Checkout' }))).id
  llm.reply = twoRules
})

afterEach(async () => {
  await proposals.idle()
  base.close()
})

describe('writing a proposal', () => {
  test('answers at once, with its first revision extracting and no deltas yet', async () => {
    llm.hold()
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))

    expect(written.revision).toBe(1)
    expect(written.extraction).toEqual({ state: 'extracting', error: null })
    expect(written.deltas.total).toBe(0)
    const [revision] = (await as(author, () => proposals.revisions(workspaceId, written.key, { size: 1 }))).items
    expect(revision!.extraction).toBe('extracting')
    expect(revision!.document).toBe(DOCUMENT)

    llm.release()
    await settle()
  })

  test('the worker extracts its deltas and the revision becomes ready with them and its questions', async () => {
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))
    await settle()

    const proposal = await as(author, () => proposals.get(workspaceId, written.key))
    expect(proposal.extraction).toEqual({ state: 'ready', error: null })
    expect(proposal.deltas).toEqual({ total: 2, approved: 0, rejected: 0, pending: 2 })
    expect(proposal.unpublished).toBe(false)
    const revision = await as(author, () => proposals.revision(workspaceId, written.key, 1))
    expect(revision).toMatchObject({ extraction: 'ready', extractionError: null, added: 2, changed: 0, removed: 0 })
    expect(revision.questions).toEqual([{ question: 'Does the limit apply in Mexico?', sources: ['Guests cannot pay more than 500 EUR per order.'] }])
    expect(llm.calls).toBe(1)
  })

  test('a failed extraction is noted with why, and retrying it extracts it again', async () => {
    llm.reply = () => {
      throw new Error('claude -p timed out')
    }
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))
    await settle()

    const failed = await as(author, () => proposals.get(workspaceId, written.key))
    expect(failed.extraction?.state).toBe('failed')
    expect(failed.extraction?.error).toContain('claude -p timed out')
    expect((await as(author, () => proposals.revision(workspaceId, written.key, 1))).extractionError).toContain('claude -p timed out')

    llm.reply = twoRules
    const retried = await as(author, () => proposals.retryExtraction(workspaceId, written.key))
    expect(retried.extraction).toEqual({ state: 'extracting', error: null })
    await settle()

    const ready = await as(author, () => proposals.get(workspaceId, written.key))
    expect(ready.extraction).toEqual({ state: 'ready', error: null })
    expect(ready.revision).toBe(1)
    expect(ready.deltas.total).toBe(2)
  })

  test('only a failed extraction is retried', async () => {
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))
    await settle()
    await expect(as(author, () => proposals.retryExtraction(workspaceId, written.key))).rejects.toThrow(RevisionNotFailed)
  })

  test('the server, when it starts again, extracts the revisions left extracting', async () => {
    llm.reply = () => {
      throw new Error('the server stopped')
    }
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))
    await settle()
    // As if the server had stopped halfway through it.
    base.db.sqlite.run(`UPDATE proposal__revision SET extraction = 'extracting', extraction_error = NULL`)
    expect((await as(author, () => proposals.get(workspaceId, written.key))).extraction?.state).toBe('extracting')

    llm.reply = twoRules
    await proposals.resumeExtractions()
    await settle()

    const proposal = await as(author, () => proposals.get(workspaceId, written.key))
    expect(proposal.extraction).toEqual({ state: 'ready', error: null })
    expect(proposal.deltas.total).toBe(2)
  })
})

describe('iterating while the last revision is extracting', () => {
  test('is refused until it is ready, and then publishes the next revision', async () => {
    llm.hold()
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))

    await expect(as(author, () => proposals.iterate(workspaceId, written.key, { basedOn: 1, message: 'Second', document: `${DOCUMENT}\n\nMore.` }))).rejects.toThrow(ProposalExtracting)

    llm.release()
    await settle()
    const next = await as(author, () => proposals.iterate(workspaceId, written.key, { basedOn: 1, message: 'Second', document: `${DOCUMENT}\n\nMore.` }))
    expect(next.revision).toBe(2)
    expect(next.extraction?.state).toBe('extracting')
    await settle()
    expect((await as(author, () => proposals.get(workspaceId, written.key))).extraction?.state).toBe('ready')
  })
})

describe('reviewing while the last revision is not ready', () => {
  test('it cannot be sent to review, reviewed, approved all at once nor accepted', async () => {
    llm.hold()
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))
    await expect(as(author, () => proposals.sendToReview(workspaceId, written.key, {}))).rejects.toThrow(ProposalExtracting)
    llm.release()
    await settle()

    await as(author, () => proposals.sendToReview(workspaceId, written.key, {}))
    const [delta] = (await as(author, () => proposals.deltas(workspaceId, written.key, 'published', { size: 10 }))).items
    llm.hold()
    await as(author, () => proposals.iterate(workspaceId, written.key, { basedOn: 1, message: 'Second', document: `${DOCUMENT}\n\nMore.` }))

    await expect(as(reviewer, () => proposals.reviewDelta(workspaceId, written.key, delta!.id, { verdict: 'approved' }))).rejects.toThrow(ProposalExtracting)
    await expect(as(reviewer, () => proposals.approveAll(workspaceId, written.key))).rejects.toThrow(ProposalExtracting)
    await expect(as(reviewer, () => proposals.accept(workspaceId, written.key))).rejects.toThrow(ProposalExtracting)

    llm.reply = () => {
      throw new Error('no answer')
    }
    llm.release()
    await settle()
    await expect(as(reviewer, () => proposals.reviewDelta(workspaceId, written.key, delta!.id, { verdict: 'approved' }))).rejects.toThrow(ProposalExtractionFailed)
    await expect(as(reviewer, () => proposals.accept(workspaceId, written.key))).rejects.toThrow(ProposalExtractionFailed)
  })
})

describe('approving every delta at once', () => {
  const inReview = async () => {
    const written = await as(author, () => proposals.write(workspaceId, { title: 'Guest limit', message: 'First', document: DOCUMENT }))
    await settle()
    await as(author, () => proposals.sendToReview(workspaceId, written.key, {}))
    const deltas = (await as(author, () => proposals.deltas(workspaceId, written.key, 'published', { size: 10 }))).items
    return { key: written.key, deltas }
  }

  test('approves only the deltas the person has not reviewed, leaving their rejections as they are', async () => {
    const { key, deltas: [first, second] } = await inReview()
    await as(reviewer, () => proposals.reviewDelta(workspaceId, key, first!.id, { verdict: 'rejected', reason: 'Too low' }))

    expect(await as(reviewer, () => proposals.approveAll(workspaceId, key))).toEqual({ approved: 1 })

    const after = (await as(reviewer, () => proposals.deltas(workspaceId, key, 'published', { size: 10 }))).items
    expect(after.find(delta => delta.id === first!.id)!.status).toBe('rejected')
    expect(after.find(delta => delta.id === second!.id)!.reviews.map(review => [review.userId, review.verdict])).toEqual([[reviewer.userId, 'approved']])
    expect(await as(reviewer, () => proposals.approveAll(workspaceId, key))).toEqual({ approved: 0 })
  })

  test('as approving one: only members, while it is in review', async () => {
    const { key } = await inReview()
    await expect(as(stranger, () => proposals.approveAll(workspaceId, key))).rejects.toThrow('not found')

    await as(author, () => proposals.backToDraft(workspaceId, key))
    await expect(as(reviewer, () => proposals.approveAll(workspaceId, key))).rejects.toThrow(ProposalNotInReview)
  })
})
