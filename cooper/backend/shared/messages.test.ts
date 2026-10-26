import { expect, test } from 'bun:test'
import { join } from 'node:path'

/** The repository's root, where the `newt/*` alias resolves. */
const root = join(import.meta.dir, '../../..')

// In a process of its own: the messages are the whole process's, and every other
// test in this one reads newt's own.
test('once set at startup, newt\'s errors and its API speak cooper\'s words', async () => {
  const script = `
    import { ConcurrencyConflict, ReferenceNotFound } from 'newt/core'
    import { ApiRouteNotFound, NotSignedIn, toErrorResponse } from 'newt/http'
    import { setCooperMessages } from './cooper/backend/shared/messages'

    setCooperMessages()
    const response = toErrorResponse(new ApiRouteNotFound('GET', '/api/nothing'))
    console.log(JSON.stringify({
      conflict: new ConcurrencyConflict().message,
      reference: new ReferenceNotFound('column', 'c1').message,
      notSignedIn: new NotSignedIn().message,
      route: { status: response.status, body: await response.json() },
    }))
  `
  const child = Bun.spawn(['bun', '-e', script], { cwd: root, stdout: 'pipe', stderr: 'inherit' })
  expect(await child.exited).toBe(0)

  expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
    conflict: 'Someone else changed this a moment ago. Reload it and try again.',
    reference: 'That column is not there any more (c1)',
    notSignedIn: 'You are not signed in, or your session has ended: sign in to go on',
    route: { status: 404, body: { error: 'Cooper has nothing at GET /api/nothing', code: 'route_not_found' } },
  })
})
