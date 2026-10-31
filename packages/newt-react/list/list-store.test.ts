import { describe, expect, test } from 'bun:test'
import type { PageRequest } from '../http/page-request'
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

  test('the newest first page wins over one that was asked for before it and arrives after', async () => {
    const answers: ((page: { items: { id: string }[], hasMore: boolean, total: number }) => void)[] = []
    const list = new ListStore<{ id: string }>(() => new Promise(resolve => answers.push(resolve)))
    const first = list.loadFirstPage()
    const second = list.loadFirstPage()

    expect(answers).toHaveLength(2)
    answers[1]!({ items: [{ id: 'new-1' }], hasMore: false, total: 1 })
    await second
    answers[0]!({ items: [{ id: 'old-1' }], hasMore: true, total: 9 })
    await first

    expect(list.items.value.map(item => item.id)).toEqual(['new-1'])
    expect(list.hasMore.value).toBe(false)
    expect(list.total.value).toBe(1)
    expect(list.loading.value).toBe(false)
  })

  test('a further page asked for before a new first page is not added to it', async () => {
    const answers: ((page: { items: { id: string }[], hasMore: boolean, total: number }) => void)[] = []
    const list = new ListStore<{ id: string }>(() => new Promise(resolve => answers.push(resolve)))
    const first = list.loadFirstPage()
    answers[0]!({ items: [{ id: 'old-1' }], hasMore: true, total: 9 })
    await first

    const more = list.loadMore()
    const again = list.loadFirstPage()
    answers[2]!({ items: [{ id: 'new-1' }], hasMore: false, total: 1 })
    await again
    answers[1]!({ items: [{ id: 'old-2' }], hasMore: true, total: 9 })
    await more

    expect(list.items.value.map(item => item.id)).toEqual(['new-1'])
    expect(list.hasMore.value).toBe(false)
    expect(list.total.value).toBe(1)
    expect(list.loadingMore.value).toBe(false)
  })

  test('a failed first page leaves nothing of the one before it', async () => {
    let offline = false
    const read = pages()
    const list = new ListStore<{ id: string }>(page => (offline ? Promise.reject(new Error('offline')) : read(page)), 2)
    await list.loadFirstPage()
    offline = true
    await list.loadFirstPage()

    expect(list.failure.value).toBe('offline')
    expect(list.items.value).toEqual([])
    expect(list.hasMore.value).toBe(false)
    expect(list.total.value).toBe(0)
    expect(list.loaded.value).toBe(false)
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
