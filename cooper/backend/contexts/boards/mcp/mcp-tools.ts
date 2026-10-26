import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Page, PageRequest } from 'newt/core'
import { z } from 'zod'
import type { Boards_Modules } from '../initialize-modules'
import type { CardDTO, CardFilterDTO } from '../modules/card/card.schema'
import type { WorkspaceMemberDTO } from '../modules/workspace/workspace.schema'
import { inWorkspace } from '../workspace-scope'

/** Tools that only read. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
/** Tools that create or change, never delete. */
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

const workspaceId = z.string().describe('The workspace\'s id, from list_workspaces')
const pageArgs = {
  cursor: z.string().optional().describe('The nextCursor of the page before, to read the next one'),
  size: z.number().int().min(1).max(100).optional().describe('How many items, 20 by default'),
}

const pageOf = (args: { cursor?: string, size?: number }): PageRequest => ({ size: args.size ?? 20, cursor: args.cursor })

/** A page as a tool answers it: with the cursor of the next one, if there is one. */
function paged<T extends { id: string }, R>(page: Page<T>, map: (item: T) => R) {
  const last = page.items.at(-1)
  return { items: page.items.map(map), total: page.total, nextCursor: page.hasMore && last ? last.id : null }
}

/** What a tool returns: its answer as JSON, for the assistant to read. */
const answer = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

/** A card as the assistant reads it: its assignee by name too. */
function cardOf(card: CardDTO, members: WorkspaceMemberDTO[]) {
  const assignee = members.find(member => member.id === card.assigneeId)
  return {
    id: card.id,
    number: card.number,
    title: card.title,
    description: card.description,
    boardId: card.boardId,
    columnId: card.columnId,
    position: card.position,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
  }
}

/**
 * boards' tools, for the person whose token the assistant brings. Like the routes,
 * they only call use cases: a tool given a workspace runs in it once the person is
 * checked to belong to it (`inWorkspace`), as a route under `/workspaces/:workspaceId`.
 */
export function registerMcpTools(server: McpServer, modules: Boards_Modules): void {
  const { workspace, board, card, member } = modules
  const within = <T>(id: string, fn: () => Promise<T>) => inWorkspace(member, id, fn)

  server.registerTool('list_workspaces', {
    title: 'List workspaces',
    description: 'The workspaces the person belongs to. Every other tool takes the id of one of them.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => answer((await workspace.mine()).map(({ id, name, isAdmin }) => ({ id, name, isAdmin }))))

  server.registerTool('list_boards', {
    title: 'List boards',
    description: 'The boards of a workspace, the newest first.',
    inputSchema: { workspaceId, ...pageArgs },
    annotations: READ_ONLY,
  }, async args => within(args.workspaceId, async () =>
    answer(paged(await board.list(pageOf(args)), ({ id, name, description }) => ({ id, name, description })))))

  server.registerTool('get_board', {
    title: 'Get a board',
    description: 'A board with its columns from left to right, each with its cards from the top, and the workspace\'s members, whom its cards can be assigned to.',
    inputSchema: { workspaceId, boardId: z.string().describe('The board\'s id, from list_boards') },
    annotations: READ_ONLY,
  }, async args => within(args.workspaceId, async () => {
    const [view, members] = await Promise.all([workspace.boardView(args.boardId), workspace.members()])
    return answer({
      board: { id: view.board.id, name: view.board.name, description: view.board.description },
      columns: view.columns.map(column => ({
        id: column.id,
        name: column.name,
        cards: view.cards.filter(each => each.columnId === column.id).map(each => cardOf(each, members)),
      })),
      members: members.map(({ id, name, email }) => ({ id, name, email })),
    })
  }))

  server.registerTool('list_members', {
    title: 'List members',
    description: 'Who belongs to a workspace, its admin first: whom its cards can be assigned to, those with no card too.',
    inputSchema: { workspaceId },
    annotations: READ_ONLY,
  }, async args => within(args.workspaceId, async () =>
    answer((await workspace.members()).map(({ id, name, email, isAdmin }) => ({ id, name, email, isAdmin })))))

  server.registerTool('search_cards', {
    title: 'Search cards',
    description: 'The cards of a workspace with these words in their title or description (whatever their case), in a board, a column or assigned to someone. Everything is optional.',
    inputSchema: {
      workspaceId,
      text: z.string().max(100).optional().describe('Words the title or the description has'),
      boardId: z.string().optional(),
      columnId: z.string().optional(),
      assigneeId: z.string().optional().describe('A member\'s id, from get_board'),
      ...pageArgs,
    },
    annotations: READ_ONLY,
  }, async args => within(args.workspaceId, async () => {
    const conditions: CardFilterDTO[] = [
      ...(args.boardId ? [{ field: 'board', op: 'eq', value: args.boardId } as const] : []),
      ...(args.columnId ? [{ field: 'column', op: 'eq', value: args.columnId } as const] : []),
      ...(args.assigneeId ? [{ field: 'assignee', op: 'eq', value: args.assigneeId } as const] : []),
    ]
    const filter = conditions.length === 0 ? undefined : { and: conditions }
    const [found, members] = await Promise.all([card.search({ text: args.text, filter }, pageOf(args)), workspace.members()])
    return answer(paged(found, each => cardOf(each, members)))
  }))

  server.registerTool('create_card', {
    title: 'Create a card',
    description: 'Adds a card at the bottom of a column of a board.',
    inputSchema: {
      workspaceId,
      boardId: z.string(),
      columnId: z.string().describe('A column of the board, from get_board'),
      title: z.string().describe('Up to 200 characters'),
      description: z.string().optional(),
      assigneeId: z.string().optional().describe('A member\'s id, from get_board'),
    },
    annotations: WRITE,
  }, async ({ workspaceId: id, boardId, ...input }) => within(id, async () =>
    answer(cardOf(await card.create(boardId, input), await workspace.members()))))

  server.registerTool('move_card', {
    title: 'Move a card',
    description: 'Moves a card to a column of its board (its status), at a position from 0 at the top; at the bottom when none is given.',
    inputSchema: { workspaceId, cardId: z.string(), columnId: z.string(), position: z.number().int().min(0).optional() },
    annotations: WRITE,
  }, async ({ workspaceId: id, cardId, ...to }) => within(id, async () =>
    answer(cardOf(await card.move(cardId, to), await workspace.members()))))

  server.registerTool('assign_card', {
    title: 'Assign a card',
    description: 'Assigns a card to a member of its workspace (list_members says who they are), who is told by email; null leaves it unassigned.',
    inputSchema: { workspaceId, cardId: z.string(), assigneeId: z.string().nullable().describe('A member\'s id, from list_members; null to unassign') },
    annotations: WRITE,
  }, async ({ workspaceId: id, cardId, assigneeId }) => within(id, async () => {
    const changed = assigneeId === null ? await card.unassign(cardId) : await card.assign(cardId, { assigneeId })
    return answer(cardOf(changed, await workspace.members()))
  }))
}
