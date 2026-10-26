import type { Page } from './page'
import type { PageRequest } from './page-request'

/** How many items each page `allPages` reads has. */
const SIZE = 100

/**
 * Every item of a list read in pages, a hundred at a time: for a list that is never
 * long (a person's workspaces, a workspace's members), never for one that grows.
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
