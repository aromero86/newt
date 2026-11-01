import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { freePort } from 'newt-kit/testing'
import { serveTestApp, type TestApp } from '../../testing/serve-test-app'
import { AppCallFailed } from './app-call-failed'
import { HttpAppClient } from './http-app-client'

const client = new HttpAppClient()
let app: TestApp

beforeEach(() => {
  app = serveTestApp()
  app.add('shop', { order: { useCases: ['place'], events: ['placed'] } })
})

afterEach(() => app.stop())

const failure = (call: Promise<unknown>) => call.then(() => null, (error: AppCallFailed) => error.reason)

describe('HttpAppClient', () => {
  test('asks an application which it is, and what it is made of, signing each request', async () => {
    expect(await client.identity(app)).toMatchObject({ name: 'shop' })
    expect((await client.structure(app)).contexts[0]!.modules[0]!.id).toBe('shop/order')
  })

  test('says why it got no answer: nobody there, a key refused, no monitor endpoint', async () => {
    expect(await failure(client.identity({ url: `http://127.0.0.1:${freePort()}`, key: app.key }))).toBe('unreachable')
    expect(await failure(client.identity({ url: app.url, key: 'another key, as long as the right one' }))).toBe('key_rejected')

    const other = Bun.serve({ port: 0, fetch: () => Response.json({ hello: 'world' }) })
    expect(await failure(client.identity({ url: other.url.origin, key: app.key }))).toBe('bad_answer')
    await other.stop(true)
  })

  test('never follows an answer that sends it elsewhere: it asks the address it was given only', async () => {
    let followed = false
    const elsewhere = Bun.serve({ port: 0, fetch: () => { followed = true; return Response.json({ name: 'shop' }) } })
    const redirecting = Bun.serve({ port: 0, fetch: request => Response.redirect(`${elsewhere.url.origin}${new URL(request.url).pathname}`, 302) })

    expect(await failure(client.identity({ url: redirecting.url.origin, key: app.key }))).toBe('bad_answer')
    expect(followed).toBe(false)
    await Promise.all([elsewhere.stop(true), redirecting.stop(true)])
  })

  test('a body that does not arrive in time is no answer, not a wrong one', async () => {
    const stalled = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('{"name":'))
          await Bun.sleep(500)
          controller.close()
        },
      }), { headers: { 'content-type': 'application/json' } }),
    })
    expect(await failure(new HttpAppClient(100).identity({ url: stalled.url.origin, key: app.key }))).toBe('unreachable')
    await stalled.stop(true)
  })
})
