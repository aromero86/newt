import type { Page } from './page'

/**
 * A page from rows read with one more than the page size: that extra row only says
 * whether more follow, and is dropped.
 */
export function toPage<T>(rows: T[], size: number, total: number): Page<T> {
  return { items: rows.slice(0, size), hasMore: rows.length > size, total }
}
