import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpRouter } from './http-router'
import { serve } from './serve'

let folder: string
const servers: Server<undefined>[] = []

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'framework-serve-'))
  await Bun.write(join(folder, 'index.html'), 'the frontend')
})

afterAll(() => rm(folder, { recursive: true }))

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})

function router(): HttpRouter {
  const router = new HttpRouter()
  router.get('/things', () => Response.json(['from the router']), { public: true })
  return router
}

describe('serve', () => {
  test('listens on its port, with the router\'s routes and the frontend for the rest', async () => {
    const server = serve({ port: 0, router: router(), frontend: folder })
    servers.push(server)

    expect(server.port).toBeGreaterThan(0)
    expect(await (await fetch(new URL('/api/things', server.url))).json()).toEqual(['from the router'])
    expect(await (await fetch(new URL('/anything', server.url))).text()).toBe('the frontend')
  })

  test('without a frontend, an address no route takes is a plain 404', async () => {
    const server = serve({ port: 0, router: router() })
    servers.push(server)

    const response = await fetch(new URL('/anything', server.url))
    expect(response.status).toBe(404)
  })

  test('takes routes beside the router\'s, which win over it', async () => {
    const server = serve({
      port: 0,
      router: router(),
      routes: { '/mcp': () => new Response('mcp'), '/api/things': () => new Response('beside') },
    })
    servers.push(server)

    expect(await (await fetch(new URL('/mcp', server.url))).text()).toBe('mcp')
    expect(await (await fetch(new URL('/api/things', server.url))).text()).toBe('beside')
  })

  test('what throws outside the router is the same 500, never a page with the source', async () => {
    const server = serve({ port: 0, router: router(), routes: { '/webhook': () => { throw new Error('secret inside') } } })
    servers.push(server)
    const original = console.error
    console.error = () => {}

    try {
      const response = await fetch(new URL('/webhook', server.url))
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Something went wrong', code: 'internal' })
    } finally {
      console.error = original
    }
  })

  // A server without an error handler fails the test that throws in it: this one runs apart.
  test('in development, Bun\'s own page answers what throws outside the router', async () => {
    const script = `
      import { HttpRouter } from '${join(import.meta.dir, 'http-router')}'
      import { serve } from '${join(import.meta.dir, 'serve')}'
      const server = serve({ port: 0, router: new HttpRouter(), development: true, routes: { '/webhook': () => { throw new Error('secret inside') } } })
      const response = await fetch(new URL('/webhook', server.url))
      console.log(response.status, response.headers.get('content-type'))
      server.stop(true)
    `
    const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'ignore' })

    const output = (await new Response(child.stdout).text()).trim()
    expect(output).toStartWith('500 ')
    expect(output).not.toContain('application/json')
  })
})
