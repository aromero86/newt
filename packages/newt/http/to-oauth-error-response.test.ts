import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { UnauthorizedError, ValidationError } from '../core'
import { MalformedBody } from './errors/malformed-body'
import { toOauthErrorResponse } from './to-oauth-error-response'

class CodeUsed extends ValidationError {
  readonly code = 'thing.code_used'
}

describe('toOauthErrorResponse', () => {
  test('a domain error becomes the OAuth error it is mapped to, with its status', async () => {
    const response = toOauthErrorResponse(new CodeUsed('Used'), 'invalid_request', { 'thing.code_used': 'invalid_grant' })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_grant', error_description: 'Used' })
  })

  test('a domain error nobody mapped is the fallback', async () => {
    const response = toOauthErrorResponse(new CodeUsed('Used'), 'invalid_request')

    expect(await response.json()).toMatchObject({ error: 'invalid_request' })
  })

  test('invalid input is the fallback, a 400, saying what is wrong', async () => {
    const parsed = z.object({ code: z.string('Falta el código') }).safeParse({})

    const response = toOauthErrorResponse(parsed.error, 'invalid_client_metadata')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_client_metadata', error_description: 'Falta el código' })
  })

  test('a body that cannot be read is the fallback too', async () => {
    const error = await new Request('http://app.test', { method: 'POST', body: 'not json' }).json().catch(caught => caught)

    expect(await toOauthErrorResponse(error, 'invalid_request').json()).toMatchObject({ error: 'invalid_request' })
  })

  test('nobody caches an answer about tokens', () => {
    expect(toOauthErrorResponse(new CodeUsed('Used'), 'invalid_request').headers.get('cache-control')).toBe('no-store')
  })

  test('anything else is a server_error that tells nothing about the inside', async () => {
    const original = console.error
    console.error = () => {}
    try {
      const response = toOauthErrorResponse(new Error('database exploded'), 'invalid_request')

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'server_error', error_description: 'Something went wrong' })
    } finally {
      console.error = original
    }
  })

  test('keeps the status of the domain error', () => {
    class Expired extends UnauthorizedError {
      readonly code = 'thing.expired'
    }
    expect(toOauthErrorResponse(new Expired('Expired'), 'invalid_request').status).toBe(401)
  })

  test('a form that cannot be read inside `handle` is the fallback, a 400', async () => {
    const response = toOauthErrorResponse(new MalformedBody(), 'invalid_request')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_request' })
  })

  test('a TypeError is a bug of the server\'s, not the client\'s: a server_error', () => {
    const original = console.error
    console.error = () => {}
    try {
      const error = (() => { try { (undefined as unknown as { client: string }).client } catch (caught) { return caught } })()

      expect(toOauthErrorResponse(error, 'invalid_request').status).toBe(500)
    } finally {
      console.error = original
    }
  })
})
