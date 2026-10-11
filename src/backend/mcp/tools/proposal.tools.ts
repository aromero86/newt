import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DeltaDTO } from '../../modules/delta/delta.schema'
import { ProposalStatusSchema, type ProposalDTO } from '../../modules/proposal/proposal.schema'
import { answer, pageArgs, pageRequest, paged, type McpContext } from '../mcp-context'

const workspaceId = z.string().describe('The workspace id, from list_workspaces')
const key = z.string().describe('PROP-42')
const message = z.string().describe('Like a commit message: what this revision changes, under 200 characters')

/** A delta as it is written; the delta module checks it whole. */
const delta = {
  kind: z.enum(['dimension', 'feature-area', 'feature', 'rule']),
  operation: z.enum(['create', 'change', 'retire', 'restore']).describe('Rules are created, changed or retired'),
  targetId: z.string().optional().describe('The artifact it changes, retires or restores; left out to create'),
  after: z.record(z.string(), z.unknown()).optional().describe([
    'The state it leaves the artifact in, to create or change it; left out to retire or restore:',
    '- feature-area: { name, description? }',
    '- feature: { areaId, name, description? } (another areaId moves it)',
    '- rule, to create: { featureId, kind, statement, why, scope?, criteria? }; to change, the same but featureId: its whole new version',
    '  kind: permission | validation | flow | calculation | legal | non-functional',
    '  scope: [{ dimensionId, valueIds: [...] }], only the dimensions it does not hold in all values of; [] means everywhere',
    '  criteria: [{ given, when, then }]',
    '- dimension: { name, values: [{ id?, name, retired? }] }, every value, new ones without id',
  ].join('\n')),
}
const added = z.object({ ...delta, ref: z.string().optional().describe('A name for what it creates; later deltas of this call write "ref:<name>" where its id goes') })

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
    description: 'One proposal: its state, its last revision (to iterate on it, pass it as basedOn), its document, its deltas with their reviews, and its last revisions.',
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
      revisions: revisions.items.map(revision => ({ number: revision.number, message: revision.message, by: revision.publishedBy.nick, at: revision.publishedAt, assistant: revision.assistant })),
    })
  })

  server.registerTool('write_proposal', {
    title: 'Write a proposal',
    description: 'A new proposal, written whole: its title, its Markdown document and its deltas, published as its first revision. It starts as a draft.',
    inputSchema: {
      workspaceId,
      title: z.string().describe('Under 120 characters'),
      document: z.string().describe('Markdown: context, problem, decisions and open questions'),
      message,
      deltas: z.array(added).describe('In the order they apply'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async args => {
    const proposal = await modules.proposal.write(args.workspaceId, { title: args.title, document: args.document, message: args.message, add: args.deltas })
    return answer(summaryOf(proposal))
  })

  server.registerTool('iterate_proposal', {
    title: 'Iterate on a proposal',
    description: 'Changes a draft or a proposal in review and publishes the change as its next revision. Deltas that do not change keep their approvals; changed ones go back to pending.',
    inputSchema: {
      workspaceId,
      key,
      basedOn: z.number().int().describe('The revision you read with get_proposal: if another came after it, nothing is written'),
      message,
      title: z.string().optional(),
      document: z.string().optional().describe('The whole new document; left out, it stays as it is'),
      add: z.array(added).optional(),
      rewrite: z.array(z.object({ id: z.string().describe('The delta id'), ...delta })).optional().describe('Deltas written again, whole'),
      remove: z.array(z.string()).optional().describe('Ids of deltas to take out'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ workspaceId: id, key: proposalKey, ...input }) => answer(summaryOf(await modules.proposal.iterate(id, proposalKey, input))))

  server.registerTool('submit_proposal', {
    title: 'Send a proposal to review',
    description: 'A draft goes to review, for people to approve it delta by delta in the web. Only when the person asks for it.',
    inputSchema: { workspaceId, key },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async args => answer(summaryOf(await modules.proposal.submit(args.workspaceId, args.key, {}))))
}
