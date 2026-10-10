import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ConflictError } from '../../core/errors/conflict-error'
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

  test('invalid input is a 400', async () => {
    const parsed = z.object({ title: z.string() }).safeParse({})

    const response = toErrorResponse(parsed.error)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'validation' })
  })

  test('anything else is a 500 that tells nothing about the inside', async () => {
    const original = console.error
    console.error = () => {}
    try {
      const response = toErrorResponse(new Error('database file is locked'))

      expect(response.status).toBe(500)
      expect(JSON.stringify(await response.json())).not.toContain('locked')
    } finally {
      console.error = original
    }
  })
})
