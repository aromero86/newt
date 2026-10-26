import { describe, expect, test } from 'bun:test'
import { mapPage } from './map-page'

describe('mapPage', () => {
  test('makes each item another, keeping whether more follow and the total', () => {
    expect(mapPage({ items: [{ id: 'a' }, { id: 'b' }], hasMore: false, total: 2 }, item => item.id.toUpperCase()))
      .toEqual({ items: ['A', 'B'], hasMore: false, total: 2 })
  })

  test('leaves out the ones it makes undefined, and the next page starts after its own last item', () => {
    const page = mapPage({ items: [{ id: 'a1', user: 'ana' }, { id: 'a2', user: 'gone' }], hasMore: true, total: 5 }, access => (access.user === 'gone' ? undefined : { id: access.user }))

    expect(page).toEqual({ items: [{ id: 'ana' }], hasMore: true, total: 5, nextCursor: 'a2' })
  })

  test('keeps the cursor of a page made from another already', () => {
    expect(mapPage({ items: [{ id: 'b' }], hasMore: true, total: 9, nextCursor: 'x' }, item => item).nextCursor).toBe('x')
  })

  test('says no cursor on the last page', () => {
    expect('nextCursor' in mapPage({ items: [{ id: 'a' }], hasMore: false, total: 1 }, item => item)).toBe(false)
  })
})
