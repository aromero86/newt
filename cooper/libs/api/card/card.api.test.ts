import { afterEach, describe, expect, test } from 'bun:test'
import { CardApi } from './card.api'

const originalFetch = globalThis.fetch
const sent: Headers[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  sent.length = 0
})

describe('CardApi', () => {
  test('sends each new card with an Idempotency-Key of its own, or the one it is given again', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers))
      return Response.json({ id: 'c-1' }, { status: 201 })
    }) as typeof fetch
    const cards = new CardApi()
    const input = { columnId: 'todo', title: 'Plan' }

    await cards.create('acme', 'roadmap', input)
    await cards.create('acme', 'roadmap', input)
    await cards.create('acme', 'roadmap', input, 'submit-1')

    const keys = sent.map(headers => headers.get('idempotency-key'))
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).not.toBe(keys[0])
    expect(keys[2]).toBe('submit-1')
    expect(sent[0]!.get('content-type')).toBe('application/json')
  })
})
