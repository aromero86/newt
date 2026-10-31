import { afterEach, describe, expect, test } from 'bun:test'
import { ApiError } from './api-error'
import { Requester } from './requester'

class NotesApi extends Requester {
  protected readonly path = '/notes'

  list(params?: { size?: number, fromId?: string }) {
    return this.get<{ items: string[] }>('', params)
  }

  create(title: string) {
    return this.post<{ id: string }>('', { title })
  }
}

const originalFetch = globalThis.fetch
const calls: { url: string, init?: RequestInit }[] = []

function answer(response: Response) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return response
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
  calls.length = 0
})

describe('Requester', () => {
  test('builds the URL from the base, the path and the defined params', async () => {
    answer(Response.json({ items: [] }))

    await new NotesApi().list({ size: 20, fromId: undefined })

    expect(calls[0]!.url).toBe('/api/notes?size=20')
  })

  test('starts every path at the base an app sets, `/api` unless told', async () => {
    answer(Response.json({ items: [] }))
    Requester.baseUrl = '/monitor/api'

    try {
      await new NotesApi().list()
    } finally {
      Requester.baseUrl = '/api'
    }

    expect(calls[0]!.url).toBe('/monitor/api/notes')
  })

  test('sends and reads JSON', async () => {
    answer(Response.json({ id: 'n-1' }))

    expect(await new NotesApi().create('Kickoff')).toEqual({ id: 'n-1' })
    expect(calls[0]!.init?.method).toBe('POST')
    expect(calls[0]!.init?.body).toBe('{"title":"Kickoff"}')
  })

  test("turns a failed answer into an ApiError with the backend's status and code", async () => {
    answer(Response.json({ error: 'Note x not found', code: 'note.not_found' }, { status: 404 }))

    const failure = await new NotesApi().list().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ status: 404, code: 'note.not_found', message: 'Note x not found' })
  })

  test('a failed answer without a JSON body or a status text still says what failed', async () => {
    answer(new Response('<html>Bad Gateway</html>', { status: 502, statusText: '', headers: { 'content-type': 'text/html' } }))

    const failure = await new NotesApi().list().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ status: 502, message: 'Request failed (502)' })
  })

  test('a refusal (403) calls the forbidden hook with the ApiError and its code', async () => {
    answer(Response.json({ error: 'Only the staff', code: 'staff.not_staff' }, { status: 403 }))
    const seen: ApiError[] = []
    Requester.onForbidden = error => seen.push(error)

    try {
      await new NotesApi().list().catch(() => undefined)
    } finally {
      Requester.onForbidden = null
    }

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ status: 403, code: 'staff.not_staff' })
  })

  test('no answer at all is an ApiError with status 0', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch

    await expect(new NotesApi().list()).rejects.toMatchObject({ status: 0 })
  })
})
