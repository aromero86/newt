import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { NoopTracer, setTracer, type Tracer } from '../core'
import { HttpRouter } from '../http'
import type { Job, Outbox } from '../port-outbox'
import { TransactionScope, type Store } from '../port-store'
import { Base, BoundedContext, MemoryMetrics, setMetrics } from '../runtime'
import { applicationMetrics, applicationSampler, InstanceSampler } from '../runtime/internal'
import { runContexts } from './run-contexts'
import type { ContextToRun } from './context-to-run'

afterEach(() => {
  setTracer(new NoopTracer())
  applicationSampler.value = null
  applicationMetrics.value = null
})

/** A context that says in `log` when it starts, when its worker stops and when it closes. */
function context(name: string, log: string[]): ContextToRun['context'] {
  return {
    name,
    start: () => void log.push(`${name} started`),
    stopWorker: async () => {
      await Bun.sleep(5)
      log.push(`${name} worker stopped`)
    },
    close: async () => void log.push(`${name} closed`),
  }
}

/** A store that says in `log` when it closes, and whose outbox hands its worker `jobs` once. */
function fakeStore(name: string, log: string[], jobs: Job[] = []): Store {
  const scope = new TransactionScope()
  const outbox = {
    add: async () => {},
    claim: async () => jobs.splice(0),
    renew: async () => {},
    close: async () => void log.push(`${name} job closed`),
    seen: async () => {},
    purge: async () => {},
    list: async () => [],
    queues: async () => [],
    depth: async () => [],
    waiting: async () => [],
  } as unknown as Outbox
  return {
    transaction: fn => scope.run(fn, undefined, { begin() {}, commit() {}, rollback() {} }),
    guard: async () => {},
    afterCommit: fn => scope.afterCommit(fn),
    afterRollback: fn => scope.afterRollback(fn),
    table: () => { throw new Error('no tables here') },
    outbox,
    migrations: {} as never,
    close: async () => void log.push(`${name} store closed`),
  }
}

class Context extends BoundedContext {
  constructor(name: string, base: Base) {
    super(name, base)
  }
}

function job(queue: string, event: string): Job {
  const now = new Date().toISOString()
  return {
    id: 'j1', queue, event: JSON.stringify({ id: 'e1', name: event, payload: {}, occurredAt: now }),
    status: 'running', attempts: 0, runAfter: now, lockedBy: null, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now,
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
    expect(log.slice(3, 6).sort()).toEqual(['auth worker stopped', 'reports worker stopped', 'shop worker stopped'])
    expect(log.slice(6)).toEqual(['reports closed', 'shop closed', 'auth closed'])
    await expect(fetch(new URL('/api/who', url))).rejects.toThrow()
  })

  test('says the instance stopped, before any context stops and closes its metrics', async () => {
    const log: string[] = []
    const metrics = new MemoryMetrics()
    metrics.enable()
    const clock = { now: () => new Date('2026-01-01T10:00:05Z') }
    applicationSampler.value = new InstanceSampler(metrics, { instance: 'i-1', startedAt: '2026-01-01T10:00:00.000Z', clock })
    await applicationSampler.value.take()
    const stopped = metrics.stopped.bind(metrics)
    metrics.stopped = async (instance, at) => {
      log.push('instance stopped')
      await stopped(instance, at)
    }

    const app = runContexts([{ context: context('shop', log) }], { signals: false })
    await app.stop()
    expect(log).toEqual(['shop started', 'instance stopped', 'shop worker stopped', 'shop closed'])
    expect((await metrics.instances(null, clock.now())).instances[0]!.status).toBe('stopped')
  })

  test('sets the application\'s tracer, which every request is a span of, and has it send what it keeps once stopped', async () => {
    const log: string[] = []
    const tracer: Tracer = {
      startActiveSpan: (name, _attributes, fn) => {
        log.push(name)
        return fn({ setError() {}, addEvent() {}, end() {} })
      },
      flush: async () => void log.push('flushed'),
    }
    const app = runContexts([{ context: context('shop', log), serve: { port: 0, router: router('shop') } }], { tracer, signals: false })
    await fetch(new URL('/api/who', app.servers.shop!.url))
    await app.stop()
    expect(log).toEqual(['shop started', 'GET /api/who', 'shop worker stopped', 'shop closed', 'flushed'])
  })

  test('stops every worker before closing any store: a context\'s handler of another\'s event runs on that one\'s worker', async () => {
    const log: string[] = []
    const boards = new Base({ name: 'boards', store: fakeStore('boards', log, [job('metric.recordCard.on.card.created', 'card.created')]), jobs: { pollMs: 5 } })
    const backoffice = new Base({ name: 'backoffice', store: fakeStore('backoffice', log) })
    const running = Promise.withResolvers<void>()
    // backoffice's handler, on boards' bus: boards' worker runs it, and it writes backoffice's store.
    boards.bus.subscribe('card.created', async () => {
      running.resolve()
      await Bun.sleep(20)
      log.push('handler wrote backoffice')
    }, { mode: 'handler', name: 'metric.recordCard.on.card.created' })

    const app = runContexts([{ context: new Context('boards', boards) }, { context: new Context('backoffice', backoffice) }], { signals: false })
    await running.promise
    await app.stop()

    expect(log).toEqual(['handler wrote backoffice', 'boards job closed', 'backoffice store closed', 'boards store closed'])
  })

  test('closes the application\'s metrics once, after every context\'s worker stopped and its store closed', async () => {
    const log: string[] = []
    const metrics = new MemoryMetrics()
    metrics.close = async () => void log.push('metrics closed')
    setMetrics(metrics)
    const auth = new Base({ name: 'auth', store: fakeStore('auth', log) })
    const shop = new Base({ name: 'shop', store: fakeStore('shop', log) })
    for (const base of [auth, shop]) base.jobs.stop = async () => void log.push(`${base.name} worker stopped`)

    const app = runContexts([{ context: new Context('auth', auth) }, { context: new Context('shop', shop) }], { signals: false })
    await app.stop()

    expect(log).toEqual(['auth worker stopped', 'shop worker stopped', 'shop store closed', 'auth store closed', 'metrics closed'])
  })

  test('closes a stream that never ends once the stop\'s deadline passes, then stops the contexts', async () => {
    const log: string[] = []
    const stream = () => new Response(new ReadableStream({ start: controller => controller.enqueue(new TextEncoder().encode('data: live\n\n')) }), {
      headers: { 'content-type': 'text/event-stream' },
    })
    const app = runContexts([
      { context: context('monitor', log), serve: { port: 0, router: router('monitor'), routes: { '/live': stream } } },
    ], { signals: false, stopTimeoutMs: 100 })
    const reader = (await fetch(new URL('/live', app.servers.monitor!.url))).body!.getReader()
    await reader.read()

    const started = performance.now()
    const stopped = await Promise.race([app.stop().then(() => 'stopped'), Bun.sleep(2000).then(() => 'hung')])
    expect(stopped).toBe('stopped')
    expect(performance.now() - started).toBeLessThan(1000)
    expect(log).toEqual(['monitor started', 'monitor stopped'])
    await reader.cancel().catch(() => {})
  })

  test('on SIGTERM it stops them, then ends the process', async () => {
    const script = `
      import { runContexts } from '${join(import.meta.dir, 'run-contexts')}'
      const context = name => ({ name, start: () => console.log(name, 'started'), stopWorker: async () => {}, close: async () => console.log(name, 'stopped') })
      runContexts([{ context: context('auth') }, { context: context('shop') }])
      process.kill(process.pid, 'SIGTERM')
      setTimeout(() => console.log('still running'), 2000)
    `
    const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })

    expect(await child.exited).toBe(0)
    expect((await new Response(child.stdout).text()).trim().split('\n')).toEqual(['auth started', 'shop started', 'shop stopped', 'auth stopped'])
  })
})
