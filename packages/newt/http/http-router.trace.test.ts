import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { NoopTracer, setTracer, type Tracer } from '../core'
import { Invocations } from '../core/internal'
import { HttpRouter } from './http-router'

const servers: Server<undefined>[] = []

afterEach(async () => {
  setTracer(new NoopTracer())
  for (const server of servers.splice(0)) await server.stop()
})

/** A tracer that writes each span as it starts, indented by how deep it is, and each error. */
function recorder(lines: string[]): Tracer {
  let depth = 0
  return {
    startActiveSpan: async (name, attributes, fn) => {
      lines.push(`${'  '.repeat(depth)}${attributes.context ? `${attributes.context} ` : ''}${name}`)
      depth++
      try {
        return await fn({ setError: error => void lines.push(`error: ${(error as Error).message}`), addEvent() {}, end() {} })
      } finally {
        depth--
      }
    },
  }
}

describe('HttpRouter, traced', () => {
  test('a request is one trace on the application\'s tracer: the use cases of every context it calls inside it', async () => {
    const lines: string[] = []
    setTracer(recorder(lines))
    const auth = new Invocations(undefined, { context: 'auth' })
    const boards = new Invocations(undefined, { context: 'boards' })
    const router = new HttpRouter()
    router.get('/boards/:id', async request => Response.json(await boards.run('board.get', async () => {
      await auth.run('access.check', async () => true)
      return { id: request.params.id }
    })), { public: true })
    router.get('/broken', () => { throw new Error('disk full') }, { public: true })
    const server = Bun.serve({ port: 0, routes: router.routes(), fetch: () => new Response('frontend') })
    servers.push(server)

    expect(await (await fetch(new URL('/api/boards/1', server.url))).json()).toEqual({ id: '1' })
    expect((await fetch(new URL('/api/broken', server.url))).status).toBe(500)
    expect(lines).toEqual([
      'GET /api/boards/:id',
      '  boards board.get',
      '    auth access.check',
      'GET /api/broken',
      'error: GET /api/broken answered 500',
    ])
  })
})
