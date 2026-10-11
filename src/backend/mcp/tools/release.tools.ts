import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { answer, pageArgs, pageRequest, paged, type McpContext } from '../mcp-context'

const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
const workspaceId = z.string().describe('The workspace id, from list_workspaces')

/** Reading the releases: pictures of the definition in force, and what changed between them. */
export function registerReleaseTools(server: McpServer, { modules, links }: McpContext) {
  server.registerTool('list_releases', {
    title: 'List releases',
    description: 'The releases of a workspace, newest first: each a picture of the definition in force when it was published.',
    inputSchema: { workspaceId, ...pageArgs },
    annotations: READ_ONLY,
  }, async args => answer(paged(await modules.release.list(args.workspaceId, pageRequest(args)), release => ({
    name: release.name, description: release.description, publishedBy: release.publishedBy.nick, publishedAt: release.publishedAt, changes: release.changes, url: links.release(args.workspaceId, release.name),
  }))))

  server.registerTool('list_release_changes', {
    title: 'List release changes',
    description: 'What a release changed since the one before it, or, without a release, what changed in force since the last one and is not released yet. Each change with the proposals behind it.',
    inputSchema: { workspaceId, release: z.string().optional().describe('Its name, such as v2.4.0; leave it out for what is not released yet'), ...pageArgs },
    annotations: READ_ONLY,
  }, async args => {
    const changes = args.release
      ? await modules.release.changes(args.workspaceId, args.release, pageRequest(args))
      : await modules.release.unpublished(args.workspaceId, pageRequest(args))
    return answer({
      release: args.release ?? 'not released yet',
      ...paged(changes, change => ({
        kind: change.kind, change: change.change, label: change.label, before: change.before, after: change.after,
        proposals: change.proposals.map(proposal => ({ ...proposal, url: links.proposal(args.workspaceId, proposal.key) })),
      })),
    })
  })
}
