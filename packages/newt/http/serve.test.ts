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
})
