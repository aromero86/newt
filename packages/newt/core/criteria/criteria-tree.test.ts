import { describe, expect, test } from 'bun:test'
import { allOf } from './all-of'
import { criteriaTree } from './criteria-tree'
import { isCondition } from './is-condition'

describe('criteriaTree', () => {
  test('one field is that field, a value its equality', () => {
    expect(criteriaTree({ name: 'Acme' })).toEqual({ kind: 'field', field: 'name', condition: { eq: 'Acme' } })
  })

  test('several fields are all of them; and and or nest', () => {
    expect(criteriaTree<Record<string, unknown>>({ a: 1, or: [{ b: { lt: 2 } }, { and: [{ c: null }] }] })).toEqual({
      kind: 'all',
      of: [
        { kind: 'field', field: 'a', condition: { eq: 1 } },
        { kind: 'any', of: [{ kind: 'field', field: 'b', condition: { lt: 2 } }, { kind: 'all', of: [{ kind: 'field', field: 'c', condition: { eq: null } }] }] },
      ],
    })
  })

  test('leaves out what is undefined, down to each operator', () => {
    expect(criteriaTree<Record<string, unknown>>({ a: undefined, b: { gt: undefined, lt: 3 }, c: { gt: undefined } })).toEqual({ kind: 'field', field: 'b', condition: { lt: 3 } })
    expect(criteriaTree()).toEqual({ kind: 'all', of: [] })
  })

  test('an empty condition is no condition, as one whose operators are all undefined', () => {
    expect(criteriaTree<Record<string, unknown>>({ a: {}, b: 2 })).toEqual({ kind: 'field', field: 'b', condition: { eq: 2 } })
  })
})

describe('isCondition', () => {
  test('an object of operators only', () => {
    expect(isCondition({ lt: 1, gte: 0 })).toBe(true)
    expect(isCondition({})).toBe(true)
    expect(isCondition({ lt: 1, label: 'x' })).toBe(false)
    expect(isCondition(null)).toBe(false)
    expect(isCondition([1])).toBe(false)
    expect(isCondition('lt')).toBe(false)
    expect(isCondition(new Date())).toBe(false)
  })
})

describe('allOf', () => {
  test('asks both', () => {
    expect(allOf<{ a: number }>({ a: 1 }, { a: { lt: 5 } })).toEqual({ and: [{ a: 1 }, { a: { lt: 5 } }] })
  })
})
