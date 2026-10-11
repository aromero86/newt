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
    description: 'One proposal: its state, its last revision (to iterate on it, pass it as basedOn), its document, the deltas read from it (each with the sentences it comes from and its reviews), the questions its last revision left open, and its last revisions.',
    inputSchema: { workspaceId, key, deltasCursor: z.string().optional().describe('The deltas.nextCursor of the answer before, for more deltas') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async args => {
    const proposal = await modules.proposal.get(args.workspaceId, args.key)
    const deltas = await modules.proposal.deltas(args.workspaceId, args.key, 'working', { size: 50, cursor: args.deltasCursor })
    const revisions = await modules.proposal.revisions(args.workspaceId, args.key, { size: 10 })
    return answer({
      ...summaryOf(proposal),
      unpublishedChanges: proposal.unpublished
        ? 'Someone has changes in the web that no revision published yet: it cannot be iterated until they publish or discard them'
        : false,
      document: proposal.document,
      deltas: paged(deltas, deltaOf),
      questions: revisions.items[0]?.questions ?? [],
      revisions: revisions.items.map(revision => ({ number: revision.number, message: revision.message, by: revision.publishedBy.nick, at: revision.publishedAt, assistant: revision.assistant })),
    })
  })

  /** What a revision left: the proposal, the deltas read from its document and what the reading could not settle. */
  const revised = async (proposal: ProposalDTO) => {
    const deltas = await modules.proposal.deltas(proposal.workspaceId, proposal.key, 'published', { size: 50 })
    const [revision] = (await modules.proposal.revisions(proposal.workspaceId, proposal.key, { size: 1 })).items
    return answer({ ...summaryOf(proposal), deltas: paged(deltas, deltaOf), questions: revision?.questions ?? [] })
  }

  server.registerTool('write_proposal', {
    title: 'Write a proposal',
    description: 'A new proposal: its title and its Markdown document. newt reads the document and extracts its deltas (it takes a few seconds), and publishes both as its first revision. It starts as a draft. The answer has the deltas extracted and the questions the document left open: show them to the person.',
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
    description: 'Rewrites the document of a draft or a proposal in review and publishes it as its next revision, with its deltas extracted again: deltas whose meaning did not change keep their approvals; changed ones go back to pending. To change a delta, change what the document says.',
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
    description: 'A draft goes to review, for people to approve it delta by delta in the web. Only when the person asks for it.',
    inputSchema: { workspaceId, key },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async args => answer(summaryOf(await modules.proposal.sendToReview(args.workspaceId, args.key, {}))))
}
