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

  test('no answer at all is an ApiError with status 0', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch

    await expect(new NotesApi().list()).rejects.toMatchObject({ status: 0 })
  })
})
