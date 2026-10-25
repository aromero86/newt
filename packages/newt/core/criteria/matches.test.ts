import { describe, expect, test } from 'bun:test'
import { matches } from './matches'

type Row = { name: string, price: number | null, archived: boolean }

const row: Row = { name: 'Acme', price: 500, archived: false }

describe('matches', () => {
  test('a value is equality, and null is "has none"', () => {
    expect(matches(row, { name: 'Acme' })).toBe(true)
    expect(matches(row, { name: 'acme' })).toBe(false)
    expect(matches({ ...row, price: null }, { price: null })).toBe(true)
    expect(matches(row, { price: null })).toBe(false)
  })

  test('every operator', () => {
    expect(matches(row, { price: { eq: 500 } })).toBe(true)
    expect(matches(row, { price: { ne: 500 } })).toBe(false)
    expect(matches(row, { price: { in: [100, 500] } })).toBe(true)
    expect(matches(row, { price: { in: [] } })).toBe(false)
    expect(matches(row, { price: { gt: 499, lt: 501 } })).toBe(true)
    expect(matches(row, { price: { gt: 500 } })).toBe(false)
    expect(matches(row, { price: { gte: 500, lte: 500 } })).toBe(true)
    expect(matches(row, { price: { lt: 500 } })).toBe(false)
  })

  test('equality is strict: a number is not its text', () => {
    expect(matches(row, { price: '500' } as never)).toBe(false)
  })

  test('in may hold null, to find the rows that have none', () => {
    expect(matches({ ...row, price: null } as Row, { price: { in: [null, 100] } })).toBe(true)
  })

  test('ieq only compares text', () => {
    expect(matches(row, { price: { ieq: '500' } } as never)).toBe(false)
  })

  test('every operator on a field must hold', () => {
    expect(matches(row, { price: { gte: 100, lt: 200 } })).toBe(false)
  })

  test('ne holds against null, but no ordering does: as SQL answers', () => {
    const none: Row = { ...row, price: null }
    expect(matches(none, { price: { ne: 500 } })).toBe(true)
    expect(matches(row, { price: { ne: null } })).toBe(true)
    for (const condition of [{ gt: null }, { gte: null }, { lt: null }, { lte: null }]) {
      expect(matches(row, { price: condition })).toBe(false)
    }
    for (const condition of [{ gt: 0 }, { gte: 0 }, { lt: 1000 }, { lte: 1000 }]) {
      expect(matches(none, { price: condition })).toBe(false)
    }
  })

  test('ieq ignores the case of A to Z only, as SQL lower() does', () => {
    expect(matches(row, { name: { ieq: 'ACME' } })).toBe(true)
    expect(matches({ ...row, name: 'Ñandú' }, { name: { ieq: 'ñandú' } })).toBe(false)
    expect(matches({ ...row, price: null }, { price: { ieq: null } })).toBe(false)
  })

  test('what is left undefined is no condition', () => {
    expect(matches(row, { name: undefined, price: { gt: undefined, lt: 1000 } })).toBe(true)
    expect(matches(row, {})).toBe(true)
    expect(matches(row)).toBe(true)
  })

  test('and asks every one, or at least one, and they nest', () => {
    expect(matches(row, { and: [{ name: 'Acme' }, { archived: false }] })).toBe(true)
    expect(matches(row, { and: [{ name: 'Acme' }, { archived: true }] })).toBe(false)
    expect(matches(row, { or: [{ name: 'Zeta' }, { price: { lt: 600 } }] })).toBe(true)
    expect(matches(row, { or: [{ name: 'Zeta' }, { archived: true }] })).toBe(false)
    expect(matches(row, { archived: false, or: [{ name: 'Zeta' }, { and: [{ price: 500 }, { name: { ieq: 'acme' } }] }] })).toBe(true)
  })

  test('an empty or holds for nothing, an empty and for everything', () => {
    expect(matches(row, { or: [] })).toBe(false)
    expect(matches(row, { and: [] })).toBe(true)
  })

  test('a field the row does not have is null', () => {
    expect(matches(row, { missing: null } as never)).toBe(true)
  })
})
