import type { Page } from './page'
import type { PageRequest } from './page-request'

/** How many items each page `allPages` reads has. */
const SIZE = 100

/**
 * Every item of a list read in pages, a hundred at a time, held in memory at once:
 * for the whole of something the caller holds whole anyway, a list that is never long
 * (a person's workspaces, a workspace's members) or one it keeps entire (every card,
 * for a search in memory). It costs a read for each hundred and memory for all of
 * them, growing with the list: what goes through a list item by item, never needing
 * it whole, reads it a page at a time instead.
 *
 * ```ts
 * const accesses = await allPages(page => access.listForTenant(workspaceId, page))
 * ```
 */
export async function allPages<T extends { id: string }>(read: (page: PageRequest) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = []
  for (let cursor: string | undefined; ;) {
    const page = await read({ size: SIZE, cursor })
    items.push(...page.items)
    cursor = page.nextCursor ?? page.items.at(-1)?.id
    if (!page.hasMore || cursor === undefined) return items
  }
}
