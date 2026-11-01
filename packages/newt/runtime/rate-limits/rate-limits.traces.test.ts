import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SqliteStore } from '../../adapter-sqlite'
import { Module, UseCase } from '../../core'
import { applicationTraces } from '../../core/internal'
import type { Trace } from '../../core/traces/trace'
import { HttpRouter } from '../../http'
import { Base } from '../base'
import { setTraces } from '../traces/set-traces'

const MINUTE = 60_000
let kept: Trace[] = []
let base: Base<SqliteStore>

beforeEach(async () => {
  kept = []
  setTraces({ finished: (trace, wanted) => { if (wanted) kept.push(trace) }, closed: async () => ({ traces: [], until: '' }), close: async () => {} }, { sampleRate: 1 })
  applicationTraces.enabled = true
  base = new Base({ name: 'auth', store: await SqliteStore.open({ path: ':memory:' }) })
})

afterEach(async () => {
  Object.assign(applicationTraces, { sink: null, sampleRate: 0.01, enabled: false, forcing: null, maxLogs: 200 })
  await base.close()
})

class Session_Module extends Module {
  readonly signIns

  constructor() {
    super('session', base.invocations, {})
    this.signIns = base.rateLimits.define('session.signIn', { limit: 1, windowMs: MINUTE })
  }

  @UseCase()
  async signIn(email: string) {
    await this.signIns.take(email)
  }
}

/** Serves the router on a free port, and posts to it. */
async function posted(router: HttpRouter, path: string, times: number) {
  const server = Bun.serve({ port: 0, routes: router.routes(), fetch: () => new Response(null, { status: 404 }) })
  try {
    for (let i = 0; i < times; i++) await fetch(new URL(`/api${path}`, server.url), { method: 'POST' })
  } finally {
    await server.stop(true)
  }
}

const rateSpans = (trace: Trace) => trace.spans.filter(span => span.kind === 'rate-limit').map(({ name, context, outcome, attributes }) => ({ name, context, outcome, attributes }))

describe('rate limits, traced', () => {
  test('a use case\'s take is a step of its trace, the key left out; a refused one is its error', async () => {
    const sessions = new Session_Module()
    const router = new HttpRouter()
    router.post('/sign-in', async () => {
      await sessions.signIn('ana@example.com')
      return new Response(null, { status: 204 })
    }, { public: true })

    await posted(router, '/sign-in', 2)

    expect(kept.map(rateSpans)).toEqual([
      [{ name: 'session.signIn', context: 'auth', outcome: null, attributes: { limit: 1, windowMs: MINUTE, remaining: 0 } }],
      [{ name: 'session.signIn', context: 'auth', outcome: { kind: 'error', code: 'too_many_requests' }, attributes: { limit: 1, windowMs: MINUTE } }],
    ])
    expect(JSON.stringify(kept)).not.toContain('ana@example.com')
  })

  test('a route\'s take is a step of its request\'s trace, saying what it counts by', async () => {
    const router = new HttpRouter({ rateLimit: { name: 'api', limit: 1, windowMs: MINUTE } })
    router.post('/things', () => new Response(null, { status: 204 }), { public: true })

    await posted(router, '/things', 2)

    expect(kept.map(rateSpans)).toEqual([
      [{ name: 'api', context: null, outcome: null, attributes: { limit: 1, windowMs: MINUTE, by: 'ip', remaining: 0 } }],
      [{ name: 'api', context: null, outcome: { kind: 'error', code: 'too_many_requests' }, attributes: { limit: 1, windowMs: MINUTE, by: 'ip' } }],
    ])
  })

  test('a use case refused is timed with its outcome, as the monitor counts its errors', async () => {
    const timed: string[] = []
    base.metrics.time = call => void timed.push(`${call.useCase} ${call.outcome?.code ?? 'ok'}`)
    const sessions = new Session_Module()

    await sessions.signIn('ana@example.com')
    await sessions.signIn('ana@example.com').catch(() => {})

    expect(timed).toEqual(['session.signIn ok', 'session.signIn too_many_requests'])
  })
})
