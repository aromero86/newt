import { describe, expect, test } from 'bun:test'
import type { PageRequest } from '../../api/core/page-request'
import { ListStore } from './list-store'

const all = Array.from({ length: 5 }, (_, index) => ({ id: `id-${index + 1}` }))

/** Pages over `all`, like the backend: after the cursor, `size` at most. */
function pages(requests: PageRequest[] = []) {
  return async (page: PageRequest) => {
    requests.push(page)
    const start = page.cursor ? all.findIndex(item => item.id === page.cursor) + 1 : 0
    const items = all.slice(start, start + (page.size ?? 20))
    return { items, hasMore: start + items.length < all.length, total: all.length }
  }
}

describe('ListStore', () => {
  test('loads the first page', async () => {
    const list = new ListStore(pages(), 2)
    await list.loadFirstPage()

    expect(list.items.value.map(item => item.id)).toEqual(['id-1', 'id-2'])
    expect(list.hasMore.value).toBe(true)
    expect(list.total.value).toBe(5)
  })

  test('loads more after the last item shown, until there is no more', async () => {
    const requests: PageRequest[] = []
    const list = new ListStore(pages(requests), 2)
    await list.loadFirstPage()
    await list.loadMore()
    await list.loadMore()
    await list.loadMore()

    expect(list.items.value.map(item => item.id)).toEqual(['id-1', 'id-2', 'id-3', 'id-4', 'id-5'])
    expect(list.hasMore.value).toBe(false)
    expect(requests.map(request => request.cursor)).toEqual([undefined, 'id-2', 'id-4'])
  })

  test('goes on where the page said it does, past a page that came empty', async () => {
    // A search's pages: the cursor is the last id it found, whether or not that item is still there.
    const found = [['id-1', 'gone-2'], ['gone-3', 'gone-4'], ['id-5']]
    const requests: PageRequest[] = []
    const list = new ListStore<{ id: string }>(async page => {
      requests.push(page)
      const at = page.cursor === undefined ? 0 : found.findIndex(ids => ids.at(-1) === page.cursor) + 1
      const ids = found[at]!
      return { items: ids.filter(id => id.startsWith('id-')).map(id => ({ id })), hasMore: at < found.length - 1, total: 5, nextCursor: ids.at(-1) }
    }, 2)

    await list.loadFirstPage()
    expect(list.items.value.map(item => item.id)).toEqual(['id-1'])
    await list.loadMore()

    expect(list.items.value.map(item => item.id)).toEqual(['id-1', 'id-5'])
    expect(list.hasMore.value).toBe(false)
    expect(requests.map(request => request.cursor)).toEqual([undefined, 'gone-2', 'gone-4'])
  })

  test('a failed page is a failure, not a crash', async () => {
    const list = new ListStore(async () => { throw new Error('offline') })
    await list.loadFirstPage()

    expect(list.failure.value).toBe('offline')
    expect(list.loading.value).toBe(false)
  })

  test('keeps the total in step with what is added and removed', async () => {
    const list = new ListStore(pages(), 2)
    await list.loadFirstPage()
    list.prepend({ id: 'id-0' })
    list.remove('id-1')

    expect(list.items.value.map(item => item.id)).toEqual(['id-0', 'id-2'])
    expect(list.total.value).toBe(5)
  })
})
