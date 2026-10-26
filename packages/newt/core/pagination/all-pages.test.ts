import { describe, expect, test } from 'bun:test'
import { allPages } from './all-pages'
import type { PageRequest } from './page-request'
import { toPage } from './to-page'

const ids = Array.from({ length: 250 }, (_, i) => ({ id: String(i).padStart(3, '0') }))

describe('allPages', () => {
  test('reads every page, a hundred at a time, each after the last item of the one before', async () => {
    const asked: PageRequest[] = []
    const all = await allPages(async page => {
      asked.push(page)
      const after = page.cursor ? ids.filter(item => item.id > page.cursor!) : ids
      return toPage(after.slice(0, page.size + 1), page.size, ids.length)
    })

    expect(all).toEqual(ids)
    expect(asked).toEqual([{ size: 100, cursor: undefined }, { size: 100, cursor: '099' }, { size: 100, cursor: '199' }])
  })

  test('starts the next page where a page says, even after one with nothing left in it', async () => {
    const pages = [
      { items: [], hasMore: true, total: 2, nextCursor: 'gone' },
      { items: [{ id: 'b' }], hasMore: false, total: 2 },
    ]
    const asked: (string | undefined)[] = []

    expect(await allPages(async page => {
      asked.push(page.cursor)
      return pages.shift()!
    })).toEqual([{ id: 'b' }])
    expect(asked).toEqual([undefined, 'gone'])
  })
})
