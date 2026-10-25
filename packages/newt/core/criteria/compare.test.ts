import { describe, expect, test } from 'bun:test'
import { compare } from './compare'

describe('compare', () => {
  test('numbers as numbers, not as text', () => {
    expect(compare(9, 10)).toBeLessThan(0)
    expect(compare(10, 9)).toBeGreaterThan(0)
    expect(compare(5, 5)).toBe(0)
  })

  test('booleans false first', () => {
    expect(compare(false, true)).toBeLessThan(0)
    expect(compare(true, false)).toBeGreaterThan(0)
  })

  test('anything else as text', () => {
    expect(compare('a', 'b')).toBeLessThan(0)
    expect(compare('b', 'a')).toBeGreaterThan(0)
    expect(compare('2026-01-02', '2026-01-10')).toBeLessThan(0)
  })

  test('null and undefined first', () => {
    expect(compare(null, 0)).toBeLessThan(0)
    expect(compare(0, null)).toBeGreaterThan(0)
    expect(compare(undefined, 'a')).toBeLessThan(0)
    expect(compare('a', undefined)).toBeGreaterThan(0)
    expect(compare(null, null)).toBe(0)
  })
})
