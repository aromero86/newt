import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { NoopTracer, setTracer, type Tracer } from '../core'
import { HttpRouter } from '../http'
import { runContexts } from './run-contexts'
import type { ContextToRun } from './context-to-run'

afterEach(() => setTracer(new NoopTracer()))

/** A context that says in `log` when it starts and stops. */
function context(name: string, log: string[]): ContextToRun['context'] {
  return {
    name,
    start: () => void log.push(`${name} started`),
    stop: async () => {
      await Bun.sleep(5)
      log.push(`${name} stopped`)
    },
  }
}

function router(answer: string): HttpRouter {
  const router = new HttpRouter()
  router.get('/who', () => Response.json(answer), { public: true })
  return router
}

describe('runContexts', () => {
  test('serves each context that is served, starts them all, and stops them the last one first', async () => {
    const log: string[] = []
    const app = runContexts([
      { context: context('auth', log), serve: { port: 0, router: router('auth'), health: true } },
      { context: context('shop', log), serve: { port: 0, router: router('shop') } },
      { context: context('reports', log) },
    ], { signals: false })

    expect(Object.keys(app.servers)).toEqual(['auth', 'shop'])
    expect(await (await fetch(new URL('/api/who', app.servers.shop!.url))).json()).toBe('shop')
    expect((await fetch(new URL('/api/health', app.servers.auth!.url))).status).toBe(200)
    expect(log).toEqual(['auth started', 'shop started', 'reports started'])

    const url = app.servers.auth!.url
    await Promise.all([app.stop(), app.stop()])
    expect(log.slice(3)).toEqual(['reports stopped', 'shop stopped', 'auth stopped'])
    await expect(fetch(new URL('/api/who', url))).rejects.toThrow()
  })

  test('sets the application\'s tracer, which every request is a span of', async () => {
    const names: string[] = []
    const tracer: Tracer = {
      startActiveSpan: (name, _attributes, fn) => {
        names.push(name)
        return fn({ setError() {}, addEvent() {}, end() {} })
      },
    }
    const app = runContexts([{ context: context('shop', []), serve: { port: 0, router: router('shop') } }], { tracer, signals: false })
    await fetch(new URL('/api/who', app.servers.shop!.url))
    await app.stop()
    expect(names).toEqual(['GET /api/who'])
  })

  test('on SIGTERM it stops them, then ends the process', async () => {
    const script = `
      import { runContexts } from '${join(import.meta.dir, 'run-contexts')}'
      const context = name => ({ name, start: () => console.log(name, 'started'), stop: async () => console.log(name, 'stopped') })
      runContexts([{ context: context('auth') }, { context: context('shop') }])
      process.kill(process.pid, 'SIGTERM')
      setTimeout(() => console.log('still running'), 2000)
    `
    const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })

    expect(await child.exited).toBe(0)
    expect((await new Response(child.stdout).text()).trim().split('\n')).toEqual(['auth started', 'shop started', 'shop stopped', 'auth stopped'])
  })
})
