import { z } from 'zod'
import type { Page } from '../core/pagination/page'
import type { PageRequest } from '../core/pagination/page-request'
import type { initializeModules } from '../initialize-modules'

/** What the tools reach: the modules' use cases, and where the web is. */
export type McpContext = {
  modules: Awaited<ReturnType<typeof initializeModules>>
  links: McpLinks
}

/** Where each thing is in the web, for the person to open it. */
export class McpLinks {
  constructor(private readonly publicUrl: string) {}

  workspace(workspaceId: string): string {
    return `${this.publicUrl}/w/${workspaceId}`
  }

  area(workspaceId: string, areaId: string): string {
    return `${this.workspace(workspaceId)}/definition/areas/${areaId}`
  }

  feature(workspaceId: string, featureId: string): string {
    return `${this.workspace(workspaceId)}/definition/features/${featureId}`
  }

  rule(workspaceId: string, key: string): string {
    return `${this.workspace(workspaceId)}/definition/rules/${key}`
  }

  proposal(workspaceId: string, key: string): string {
    return `${this.workspace(workspaceId)}/proposals/${key}`
  }

  release(workspaceId: string, name: string): string {
    return `${this.workspace(workspaceId)}/releases/${encodeURIComponent(name)}`
  }
}

/** The arguments of a tool that answers in pages. */
export const pageArgs = {
  cursor: z.string().optional().describe('The nextCursor of the page before, to read the next one'),
  size: z.number().int().min(1).max(100).optional().describe('How many items, 20 by default'),
}

export const pageRequest = (args: { cursor?: string, size?: number }): PageRequest => ({ size: args.size ?? 20, cursor: args.cursor })

/** A page as a tool answers it: with the cursor of the next one, if there is one; the last item's id unless told. */
export function paged<T, R>(page: Page<T>, map: (item: T) => R, cursorOf: (item: T) => string = item => (item as { id: string }).id) {
  const last = page.items.at(-1)
  return { items: page.items.map(map), total: page.total, nextCursor: page.hasMore && last ? cursorOf(last) : null }
}

/** What a tool returns: its answer as JSON, for the assistant to read. */
export function answer(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}
