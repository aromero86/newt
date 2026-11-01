import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { TooManyRequests, UnauthorizedError, ValidationError } from '../core'
import { MalformedBody } from './errors/malformed-body'
import { MethodNotAllowed } from './errors/method-not-allowed'
import { handle } from './handle'
import { toOauthErrorResponse } from './to-oauth-error-response'

class CodeUsed extends ValidationError {
  readonly code = 'thing.code_used'
}

describe('toOauthErrorResponse', () => {
  test('one who ran into a rate limit says when to try again', async () => {
    const response = toOauthErrorResponse(new TooManyRequests('token.exchange', 30_000), 'invalid_request', { too_many_requests: 'slow_down' })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.json()).toMatchObject({ error: 'slow_down' })
  })

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

  test('a method the endpoint does not have is a 405, invalid_request whatever the fallback', async () => {
    const response = toOauthErrorResponse(new MethodNotAllowed('GET', '/oauth/register'), 'invalid_client_metadata')

    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'invalid_request', error_description: 'GET is not allowed on /oauth/register' })
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

  test('a broken multipart form read inside `handle`, on a real server, is the fallback too', async () => {
    const route = handle(async request => {
      try {
        return Response.json(Object.fromEntries(await request.formData()))
      } catch (error) {
        return toOauthErrorResponse(error, 'invalid_request')
      }
    })
    const server = Bun.serve({ port: 0, routes: { '/token': route } })

    try {
      const response = await fetch(new URL('/token', server.url), {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: 'garbage',
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_request' })
    } finally {
      await server.stop()
    }
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
