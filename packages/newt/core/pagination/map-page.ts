import type { Page } from './page'

/**
 * A page of other items made from each of this one's: whether more follow and the
 * total stay. An item it makes `undefined` is left out (one gone since it was read).
 * While more follow, it says where the next page starts: after this one's last item,
 * whatever it made of it.
 *
 * ```ts
 * mapPage(accesses, access => tenants.get(access.tenantId))
 * ```
 */
export function mapPage<T, R>(page: Page<T>, fn: (item: T) => R | undefined): Page<R> {
  const items = page.items.map(fn).filter(item => item !== undefined)
  const last = page.items.at(-1) as { id?: unknown } | undefined
  const nextCursor = page.nextCursor ?? (typeof last?.id === 'string' ? last.id : undefined)
  return { items, hasMore: page.hasMore, total: page.total, ...(page.hasMore && nextCursor !== undefined ? { nextCursor } : {}) }
}
