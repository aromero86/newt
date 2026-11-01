import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ConflictError, InvalidEntity, TooManyRequests } from '../core'
import { toErrorResponse } from './to-error-response'

class SlugTaken extends ConflictError {
  readonly code = 'thing.slug_taken'
}

describe('toErrorResponse', () => {
  test('a domain error keeps its status and code', async () => {
    const response = toErrorResponse(new SlugTaken('Slug taken'))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Slug taken', code: 'thing.slug_taken' })
  })

  test('one who ran into a rate limit is a 429 that says when to try again, in whole seconds', async () => {
    const response = toErrorResponse(new TooManyRequests('session.signIn', 1500))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('2')
    expect(await response.json()).toEqual({ error: 'Too many requests: try again in 2 s', code: 'too_many_requests' })
  })

  test('invalid input is a 400', async () => {
    const parsed = z.object({ title: z.string() }).safeParse({})

    const response = toErrorResponse(parsed.error)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'validation', issues: [expect.objectContaining({ path: ['title'] })] })
  })

  test('an entity that does not pass its schema is not the client\'s fault: a 500 that tells nothing', async () => {
    const parsed = z.object({ priceCents: z.number().min(0) }).safeParse({ priceCents: -5 })
    const original = console.error
    console.error = () => {}
    try {
      const response = toErrorResponse(new InvalidEntity('Product', 'p1', parsed.error!))

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toEqual({ error: 'Something went wrong', code: 'internal' })
    } finally {
      console.error = original
    }
  })

  test('anything else is a 500 that tells nothing about the inside', async () => {
    const original = console.error
    console.error = () => {}
    try {
      const response = toErrorResponse(new Error('database file is locked'))

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toMatchObject({ code: 'internal' })
      expect(JSON.stringify(body)).not.toContain('locked')
    } finally {
      console.error = original
    }
  })
})
