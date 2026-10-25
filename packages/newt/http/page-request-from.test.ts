import { describe, expect, test } from 'bun:test'
import { pageRequestFrom } from './page-request-from'

const request = (query: string) => new Request(`http://app.test/api/things${query}`)

describe('pageRequestFrom', () => {
  test('20 items from the start by default', () => {
    expect(pageRequestFrom(request(''))).toEqual({ size: 20, cursor: undefined })
  })

  test('reads the size and the cursor', () => {
    expect(pageRequestFrom(request('?size=5&cursor=abc'))).toEqual({ size: 5, cursor: 'abc' })
  })

  test('keeps the size between 1 and 100', () => {
    expect(pageRequestFrom(request('?size=0')).size).toBe(1)
    expect(pageRequestFrom(request('?size=5000')).size).toBe(100)
    expect(pageRequestFrom(request('?size=lots')).size).toBe(20)
  })

  test('an empty cursor is none, and a size below 1 is 1', () => {
    expect(pageRequestFrom(request('?cursor=')).cursor).toBeUndefined()
    expect(pageRequestFrom(request('?size=-5')).size).toBe(1)
  })
})
