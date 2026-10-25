import { describe, expect, test } from 'bun:test'
import { archivedFrom } from './archived-from'

const request = (query: string) => new Request(`http://app.test/api/things${query}`)

describe('archivedFrom', () => {
  test('all of them when not asked', () => {
    expect(archivedFrom(request(''))).toBeUndefined()
  })

  test('the archived ones, or the others', () => {
    expect(archivedFrom(request('?archived=true'))).toBe(true)
    expect(archivedFrom(request('?archived=false'))).toBe(false)
  })

  test('all of them for anything else', () => {
    expect(archivedFrom(request('?archived=yes'))).toBeUndefined()
  })
})
