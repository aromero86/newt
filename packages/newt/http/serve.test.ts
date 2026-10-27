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

  test('health: GET /api/health, or the path given, a 200 without a session', async () => {
    const server = serve({ port: 0, router: router(), health: true })
    servers.push(server)
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })

    const elsewhere = serve({ port: 0, router: router(), health: '/healthz' })
    servers.push(elsewhere)
    expect((await fetch(new URL('/healthz', elsewhere.url))).status).toBe(200)
    expect((await fetch(new URL('/api/health', elsewhere.url))).status).toBe(404)
  })

  test('once told to stop, its health is a 503 while it drains, and it answers the rest', async () => {
    const server = serve({ port: 0, router: router(), health: true, drainMs: 300 })
    const url = server.url
    const stopped = server.stop()

    const health = await fetch(new URL('/api/health', url))
    expect(health.status).toBe(503)
    expect(await health.json()).toEqual({ status: 'stopping' })
    expect((await fetch(new URL('/api/things', url))).status).toBe(200)
    await stopped
    await expect(fetch(new URL('/api/health', url))).rejects.toThrow()
  })
})

describe('serve, a frontend from its sources', () => {
  let server: Server<undefined>

  afterEach(() => server.stop(true))

  test('builds its index.html as it serves it, for every address no route takes, and its public files', async () => {
    const { default: frontend } = await import('./fixtures/frontend/index.html')
    const api = new HttpRouter()
    api.get('/things', () => Response.json([]), { public: true })
    server = serve({ port: 0, router: api, frontend, publicFolder: join(import.meta.dir, 'fixtures/frontend/public') })
    const at = (path: string) => fetch(new URL(path, server.url))

    for (const path of ['/', '/boards/1']) {
      const page = await (await at(path)).text()
      expect(page).toContain('A frontend for serve\'s test')
      const script = /<script[^>]*src="([^"]+)"/.exec(page)![1]!
      expect(await (await at(script)).text()).toContain('ready')
    }
    expect(await (await at('/icon.svg')).text()).toContain('<svg')
    expect(await (await at('/api/things')).json()).toEqual([])
  })
})
