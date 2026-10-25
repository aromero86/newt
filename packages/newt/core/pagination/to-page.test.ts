import { describe, expect, test } from 'bun:test'
import { toPage } from './to-page'

describe('toPage', () => {
  test('the extra row only says more follow, and is dropped', () => {
    expect(toPage([1, 2, 3], 2, 10)).toEqual({ items: [1, 2], hasMore: true, total: 10 })
  })

  test('without the extra row, it is the last page', () => {
    expect(toPage([1, 2], 2, 2)).toEqual({ items: [1, 2], hasMore: false, total: 2 })
    expect(toPage([], 2, 0)).toEqual({ items: [], hasMore: false, total: 0 })
  })
})
