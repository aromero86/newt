import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { HttpRouter, MAX_BODY_BYTES } from './http-router'
import { serve } from './serve'
import type { ServeOptions } from './serve-options'

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
})

const echo = async (request: Request) => Response.json({ length: JSON.stringify(await request.json()).length })

function served(router: HttpRouter, options: Partial<ServeOptions> = {}) {
  const server = serve({ port: 0, router, ...options })
  servers.push(server)
  return (path: string, body: RequestInit['body'], headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    fetch(new URL(path, server.url), { method: 'POST', headers, body })
}

/** A JSON body of about `bytes`. */
const jsonOf = (bytes: number) => JSON.stringify({ text: 'x'.repeat(bytes) })

/** A body sent in pieces, with no length told. */
function streamed(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += 1024) controller.enqueue(bytes.slice(at, at + 1024))
      controller.close()
    },
  })
}

describe('body limits', () => {
  test('a route takes a megabyte unless told: past it, a 413 the API answers', async () => {
    const router = new HttpRouter()
    router.post('/things', echo, { public: true })
    const call = served(router)

    expect((await call('/api/things', jsonOf(MAX_BODY_BYTES - 100))).status).toBe(200)
    const refused = await call('/api/things', jsonOf(MAX_BODY_BYTES * 2))
    expect(refused.status).toBe(413)
  })

  test('a route, a group or a router says how long its bodies may be', async () => {
    const router = new HttpRouter({ maxBodyBytes: 100 })
    const uploads = router.group('/uploads', (_request, next) => next(), { maxBodyBytes: 4 * MAX_BODY_BYTES })
    router.post('/small', echo, { public: true })
    router.post('/tiny', echo, { public: true, maxBodyBytes: 20 })
    uploads.post('/file', echo, { public: true })
    const call = served(router)

    expect((await call('/api/small', jsonOf(50))).status).toBe(200)
    const refused = await call('/api/small', jsonOf(200))
    expect(refused.status).toBe(413)
    expect(await refused.json()).toEqual({ error: 'The body of the request is longer than the 100 bytes it may be', code: 'payload_too_large' })
    expect((await call('/api/tiny', jsonOf(50))).status).toBe(413)
    // Longer than the server's megabyte: the server takes the longest any route takes.
    expect((await call('/api/uploads/file', jsonOf(2 * MAX_BODY_BYTES))).status).toBe(200)
  })

  test('a body sent with no length is refused as it is read, however the route reads it', async () => {
    const router = new HttpRouter({ maxBodyBytes: 2048 })
    router.post('/json', echo, { public: true })
    router.post('/text', async request => Response.json({ length: (await request.text()).length }), { public: true })
    router.post('/form', async request => Response.json({ name: (await request.formData()).get('name') }), { public: true })
    const call = served(router)

    expect(await (await call('/api/json', streamed(jsonOf(1000)))).json()).toEqual({ length: jsonOf(1000).length })
    expect((await call('/api/json', streamed(jsonOf(5000)))).status).toBe(413)
    expect((await call('/api/text', streamed('x'.repeat(5000)), { 'content-type': 'text/plain' })).status).toBe(413)
    expect(await (await call('/api/form', streamed('name=ana'), { 'content-type': 'application/x-www-form-urlencoded' })).json()).toEqual({ name: 'ana' })
    expect((await call('/api/form', streamed(`name=${'x'.repeat(5000)}`), { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(413)
  })

  test('a body with no length still says it is JSON, and is still read as it must be', async () => {
    const router = new HttpRouter()
    router.post('/json', echo, { public: true })
    const call = served(router)

    expect((await call('/api/json', streamed(jsonOf(10)), { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await call('/api/json', streamed('{ not json'))).status).toBe(400)
  })

  test('the routes beside the router\'s take the server\'s, or the longest its router\'s take', async () => {
    const router = new HttpRouter({ maxBodyBytes: 100 })
    router.post('/things', echo, { public: true })
    const call = served(router, { maxBodyBytes: 1000, routes: { '/webhook': { POST: async request => new Response(String((await request.text()).length)) } } })

    expect((await call('/webhook', 'x'.repeat(500), {})).status).toBe(200)
    expect((await call('/webhook', 'x'.repeat(5000), {})).status).toBe(413)
  })
})
