import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DeltaDTO } from '../../modules/delta/delta.schema'
import { ProposalStatusSchema, type ProposalDTO } from '../../modules/proposal/proposal.schema'
import { answer, pageArgs, pageRequest, paged, type McpContext } from '../mcp-context'

const workspaceId = z.string().describe('The workspace id, from list_workspaces')
const key = z.string().describe('PROP-42')
const message = z.string().describe('Like a commit message: what this revision changes, under 200 characters')

/** Proposals: reading them, and writing and iterating them. Never approving, accepting nor merging. */
export function registerProposalTools(server: McpServer, { modules, links }: McpContext) {
  const summaryOf = (proposal: ProposalDTO) => ({
    key: proposal.key,
    title: proposal.title,
    status: proposal.status,
    revision: proposal.revision,
    createdBy: proposal.createdBy.nick,
    deltas: proposal.deltas,
    url: links.proposal(proposal.workspaceId, proposal.key),
  })
  /** How reading the last revision's document for its deltas stands, said for an assistant. */
  const extractionOf = (proposal: ProposalDTO) => {
    const extraction = proposal.extraction
    if (!extraction) return { state: 'none', note: 'No revision published yet' }
    if (extraction.state === 'extracting') return { state: 'extracting', note: `newt is still extracting the deltas of revision ${proposal.revision} from its document (it can take a few minutes): call get_proposal later to see them and the questions it leaves` }
    if (extraction.state === 'failed') return { state: 'failed', error: extraction.error, note: `Extracting the deltas of revision ${proposal.revision} failed: the person can retry it in the web, or you can iterate_proposal again` }
    return { state: 'ready' }
  }
  const deltaOf = (each: DeltaDTO) => ({
    id: each.id,
    kind: each.kind,
    operation: each.operation,
    target: each.targetLabel,
    targetId: each.targetId,
    status: each.status,
    before: each.before,
    after: each.after,
    reviews: each.reviews.map(review => ({ by: review.nick, verdict: review.verdict, reason: review.reason || undefined })),
    from: each.sources,
    blockers: each.blockers,
  })

  server.registerTool('list_proposals', {
    title: 'List proposals',
    description: 'The proposals of a workspace, newest first; only those in these states, or with these words in their title, if given.',
    inputSchema: { workspaceId, status: z.array(ProposalStatusSchema).optional(), title: z.string().optional().describe('Words of its title, in order'), ...pageArgs },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async args => answer(paged(await modules.proposal.list(args.workspaceId, { status: args.status, title: args.title }, pageRequest(args)), summaryOf)))

  server.registerTool('get_proposal', {
    title: 'Get a proposal',
    description: 'One proposal: its state, its last revision (to iterate on it, pass it as basedOn) and how the extraction of its deltas stands (extracting, ready or failed, with the error), its document, its last revisions and, once the extraction is ready, the deltas read from it (each with the sentences it comes from and its reviews) and the questions its last revision left open.',
    inputSchema: { workspaceId, key, deltasCursor: z.string().optional().describe('The deltas.nextCursor of the answer before, for more deltas') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async args => {
    const proposal = await modules.proposal.get(args.workspaceId, args.key)
    const revisions = await modules.proposal.revisions(args.workspaceId, args.key, { size: 10 })
    // Until the last revision has its deltas, the ones there are belong to an older one.
    const ready = proposal.extraction === null || proposal.extraction.state === 'ready'
    const deltas = ready ? paged(await modules.proposal.deltas(args.workspaceId, args.key, 'working', { size: 50, cursor: args.deltasCursor }), deltaOf) : undefined
    return answer({
      ...summaryOf(proposal),
      extraction: extractionOf(proposal),
      unpublishedChanges: proposal.unpublished
        ? 'Someone has changes in the web that no revision published yet: it cannot be iterated until they publish or discard them'
        : false,
      document: proposal.document,
      ...(ready ? { deltas, questions: revisions.items[0]?.questions ?? [] } : {}),
      revisions: revisions.items.map(revision => ({ number: revision.number, message: revision.message, by: revision.publishedBy.nick, at: revision.publishedAt, assistant: revision.assistant, extraction: revision.extraction })),
    })
  })

  /** What a revision left, at once: the proposal and how the extraction of its deltas stands. They come later, with get_proposal. */
  const revised = (proposal: ProposalDTO) => answer({ key: proposal.key, url: links.proposal(proposal.workspaceId, proposal.key), status: proposal.status, revision: proposal.revision, title: proposal.title, extraction: extractionOf(proposal) })

  server.registerTool('write_proposal', {
    title: 'Write a proposal',
    description: 'A new proposal: its title and its Markdown document, published at once as its first revision. It starts as a draft. The answer has its key, its link and the extraction state: newt extracts the deltas from the document in the background (it can take a few minutes). Call get_proposal later to see the deltas and the questions the document left open, and show them to the person.',
    inputSchema: {
      workspaceId,
      title: z.string().describe('Under 120 characters'),
      document: z.string().describe('Markdown: context, problem, decisions and open questions. Every change must be stated in the decisions, with where it applies and why'),
      message,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async args => revised(await modules.proposal.write(args.workspaceId, { title: args.title, document: args.document, message: args.message })))

  server.registerTool('iterate_proposal', {
    title: 'Iterate on a proposal',
    description: 'Rewrites the document of a draft or a proposal in review and publishes it at once as its next revision; newt extracts its deltas again in the background: deltas whose meaning did not change keep their approvals; changed ones go back to pending. The answer has the key, the link and the extraction state: call get_proposal later to see the deltas and questions. Refused while the deltas of the last revision are still being extracted: wait and try again. To change a delta, change what the document says.',
    inputSchema: {
      workspaceId,
      key,
      basedOn: z.number().int().describe('The revision you read with get_proposal: if another came after it, nothing is written'),
      message,
      title: z.string().optional(),
      document: z.string().describe('The whole new document'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ workspaceId: id, key: proposalKey, ...input }) => revised(await modules.proposal.iterate(id, proposalKey, input)))

  server.registerTool('submit_proposal', {
    title: 'Send a proposal to review',
    description: 'A draft goes to review, for people to approve it delta by delta in the web. Only when the person asks for it, and once the deltas of its last revision are extracted (get_proposal says so).',
    inputSchema: { workspaceId, key },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async args => answer(summaryOf(await modules.proposal.sendToReview(args.workspaceId, args.key, {}))))
}
