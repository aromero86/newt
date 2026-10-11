import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SearchPageDTO, SearchResultDTO } from '../../modules/search/search.schema'
import { SearchKindSchema } from '../../modules/search/search.schema'
import { answer, pageArgs, pageRequest, paged, type McpContext } from '../mcp-context'

const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
const workspaceId = z.string().describe('The workspace id, from list_workspaces')

const SEMANTIC = {
  ready: 'found by words and by meaning',
  loading: 'found by words only for now: the meaning model is still loading or indexing',
  unavailable: 'found by words only: the meaning model is not available',
}

/** Finding things by their words and their meaning. */
export function registerSearchTools(server: McpServer, { modules, links }: McpContext) {
  const resultOf = (id: string, result: SearchResultDTO) => {
    const url = result.kind === 'rule' && result.key ? links.rule(id, result.key)
      : result.kind === 'feature' ? links.feature(id, result.targetId)
        : result.kind === 'feature-area' ? links.area(id, result.targetId)
          : result.key ? links.proposal(id, result.key) : null
    return {
      kind: result.kind,
      layer: result.layer,
      status: result.status,
      key: result.key ?? undefined,
      id: result.targetId,
      label: result.label,
      snippet: result.snippet,
      feature: result.feature?.name,
      appliesIn: result.scope ? (result.scope.length ? result.scope : 'everywhere') : undefined,
      plannedBy: result.proposal ?? undefined,
      version: result.status === 'superseded' ? `version ${result.version}, superseded by version ${result.currentVersion}` : undefined,
      url: result.proposal ? links.proposal(id, result.proposal.key) : url,
    }
  }
  const pageOf = (id: string, page: SearchPageDTO) => ({ search: SEMANTIC[page.semantic], ...paged(page, result => resultOf(id, result)) })

  server.registerTool('search', {
    title: 'Search',
    description: 'Finds areas, features, rules and proposals of a workspace by their words and by their meaning, in Spanish or English, best first. Each result says where it belongs (layer): in force, planned, proposals or history. Search before writing a proposal, to find what already exists about it.',
    inputSchema: {
      workspaceId,
      query: z.string().describe('What to look for, in your own words'),
      kinds: z.array(SearchKindSchema).optional(),
      featureId: z.string().optional(),
      appliesIn: z.array(z.object({ dimensionId: z.string(), valueId: z.string() })).optional().describe('At most one value per dimension: only what applies in all of them'),
      definition: z.enum(['in force', 'planned']).optional().describe('in force by default; planned adds what accepted proposals will change, marked as planned'),
      history: z.boolean().optional().describe('Also superseded versions, retired artifacts and discarded proposals, marked as such'),
      ...pageArgs,
    },
    annotations: READ_ONLY,
  }, async ({ workspaceId: id, cursor, size, ...filter }) => answer(pageOf(id, await modules.search.search(id, filter, pageRequest({ cursor, size })))))

  server.registerTool('find_similar', {
    title: 'Find similar',
    description: 'The features and rules in force that talk about the same as one artifact, closest first; never the artifact itself.',
    inputSchema: { workspaceId, targetId: z.string().describe('The id of a rule, feature or area'), ...pageArgs },
    annotations: READ_ONLY,
  }, async args => answer(pageOf(args.workspaceId, await modules.search.similar(args.workspaceId, args.targetId, pageRequest(args)))))
}
