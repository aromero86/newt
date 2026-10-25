import { describe, expect, test } from 'bun:test'
import { eventNameMatches } from './event-name-matches'

describe('eventNameMatches', () => {
  test('a name takes that event only', () => {
    expect(eventNameMatches('product.created', 'product.created')).toBe(true)
    expect(eventNameMatches('product.created', 'product.updated')).toBe(false)
    expect(eventNameMatches('product', 'product.created')).toBe(false)
  })

  test('a prefix ending in .* takes every event under it, and nothing beside it', () => {
    expect(eventNameMatches('product.*', 'product.created')).toBe(true)
    expect(eventNameMatches('product.*', 'product.price.changed')).toBe(true)
    expect(eventNameMatches('product.*', 'productX.created')).toBe(false)
    expect(eventNameMatches('product.*', 'product')).toBe(false)
    expect(eventNameMatches('product.*', 'old.product.created')).toBe(false)
  })

  test('only .* makes a prefix', () => {
    expect(eventNameMatches('product*', 'product.created')).toBe(false)
  })
})
