import { expect, test } from 'bun:test'
import { ConcurrencyConflict, DuplicateValue, ReferenceNotFound } from 'newt-kit/core'
import { ApiRouteNotFound, NotSignedIn, toErrorResponse } from 'newt-kit/http'
import { setCooperMessages } from './messages'

test('once set at startup, newt\'s errors and its API speak cooper\'s words', async () => {
  const restore = setCooperMessages()
  try {
    const response = toErrorResponse(new ApiRouteNotFound('GET', '/api/nothing'))

    expect(new ConcurrencyConflict().message).toBe('Someone else changed this a moment ago. Reload it and try again.')
    expect(new DuplicateValue(['name']).message).toBe('That is already taken: pick another one')
    expect(new ReferenceNotFound('column', 'c1').message).toBe('That column is not there any more (c1)')
    expect(new NotSignedIn().message).toBe('You are not signed in, or your session has ended: sign in to go on')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Cooper has nothing at GET /api/nothing', code: 'route_not_found' })
  } finally {
    restore()
  }
})
