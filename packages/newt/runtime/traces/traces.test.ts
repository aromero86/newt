import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { SqliteStore } from '../../adapter-sqlite'
import { ConcurrencyConflict, defineScope, Module, runAsActor, UseCase, type Actor } from '../../core'
import { applicationTraces } from '../../core/internal'
import type { Trace } from '../../core/traces/trace'
import { HttpRouter } from '../../http'
import type { StoredRow } from '../../port-store'
import { Base } from '../base'
import { MemoryTraces } from './memory-traces'
import { queryShape } from './query-shape'
import { enableTraces, setTraces } from './set-traces'

type CardRow = StoredRow & { boardId: string, title: string }
const workspace = defineScope<{ workspaceId: string }>('workspace')
const ana = { userId: 'ana' } as Actor

let kept: Trace[] = []
let base: Base<SqliteStore>

beforeEach(async () => {
  kept = []
  setTraces({ record: trace => kept.push(trace), closed: async () => ({ traces: [], until: '' }), close: async () => {} }, { sampleRate: 1 })
  applicationTraces.enabled = true
  const store = await SqliteStore.open({ path: ':memory:' })
  await store.transaction(() => store.connection.run('CREATE TABLE card (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, title TEXT NOT NULL, version INTEGER NOT NULL)'))
  base = new Base({ name: 'boards', store, jobs: { backoffMs: 1, pollMs: 5 } })
})

afterEach(async () => {
  Object.assign(applicationTraces, { sink: null, sampleRate: 0.01, enabled: false })
  await base.close()
})

/** A module of cards: one that reads and writes its table, one that fails, one that checks what it is given. */
function cards(options: { conflicts?: number } = {}) {
  let conflicts = options.conflicts ?? 0
  class Card_Module extends Module {
    readonly table = base.store.table<CardRow>('card')
    constructor() {
      super('card', base.invocations)
    }

    @UseCase()
    async create(input: unknown) {
      const { title } = z.object({ title: z.string().min(1) }).parse(input)
      await base.store.transaction(async () => {
        await this.table.find({ boardId: 'b1', title: { ne: '' } }, { orderBy: [{ field: 'title', direction: 'desc' }], limit: 50 })
        if (conflicts-- > 0) throw new ConcurrencyConflict()
        await this.table.insert({ id: crypto.randomUUID(), boardId: 'b1', title })
      })
    }

    @UseCase()
    async broken() {
      return (undefined as unknown as { vat: number }).vat
    }
  }
  return new Card_Module()
}

/** Serves the router on a free port, and posts to it. */
async function routed(router: HttpRouter, path: string) {
  const server = Bun.serve({ port: 0, routes: router.routes(), fetch: () => new Response(null, { status: 404 }) })
  try {
    return await fetch(new URL(`/api${path}`, server.url), { method: 'POST' })
  } finally {
    await server.stop(true)
  }
}

describe('traces', () => {
  test('a request is a tree: its use case, its transaction, its queries by their shape, and who asked', async () => {
    const card = cards()
    const router = new HttpRouter()
    router.post('/cards', async () => {
      await runAsActor(ana, () => workspace.run({ workspaceId: 'acme' }, () => card.create({ title: 'secret title' })))
      return new Response(null, { status: 201 })
    }, { public: true })

    await routed(router, '/cards')

    const [trace] = kept
    expect(trace).toMatchObject({ kind: 'http', name: 'POST /api/cards', outcome: null, retried: false, actor: 'ana', scopes: { workspace: 'acme' }, useCases: ['card.create'] })
    const names = trace!.spans.map(span => `${trace!.spans.find(each => each.id === span.parentId)?.name ?? '-'} > ${span.name}`)
    expect(names).toEqual(['- > POST /api/cards', 'POST /api/cards > card.create', 'card.create > transaction', 'transaction > card.find', 'transaction > card.insert'])
    const find = trace!.spans.find(span => span.name === 'card.find')!
    expect(find).toMatchObject({ kind: 'query', context: 'boards', attributes: { query: '{boardId, title ne} order title desc limit 50', rows: 0 } })
    expect(JSON.stringify(trace)).not.toContain('secret title')
    expect(JSON.stringify(trace)).not.toContain('b1')
  })

  test('a call that ran again after a conflict keeps each run, and says so, kept whatever the share', async () => {
    applicationTraces.sampleRate = 0
    const card = cards({ conflicts: 1 })
    await enableAndRoot(() => card.create({ title: 'a' }))

    const [trace] = kept
    expect(trace!.retried).toBe(true)
    const call = trace!.spans.find(span => span.name === 'card.create')!
    expect(call.attributes.runs).toBe(2)
    const runs = trace!.spans.filter(span => span.parentId === call.id)
    expect(runs.map(run => [run.name, run.outcome?.code ?? null])).toEqual([['attempt 1', 'concurrency_conflict'], ['attempt 2', null]])
  })

  test('a failure keeps its message and stack once, where it happened; a validation, the fields it found wrong', async () => {
    const card = cards()
    await enableAndRoot(() => card.broken()).catch(() => undefined)
    await enableAndRoot(() => card.create({ title: '' })).catch(() => undefined)

    const [failed, invalid] = kept
    expect(failed!.outcome).toEqual({ kind: 'failure', code: 'TypeError' })
    expect(failed!.spans.filter(span => span.failure).map(span => span.name)).toEqual(['card.broken'])
    expect(failed!.spans.find(span => span.failure)!.failure!.message).toContain('vat')
    expect(invalid!.outcome).toEqual({ kind: 'error', code: 'validation' })
    expect(invalid!.spans.find(span => span.name === 'card.create')!.attributes['validation.fields']).toBe('title')
  })

  test('keeps a share of the traces that went well, and none at 0', async () => {
    applicationTraces.sampleRate = 0
    const card = cards()
    await enableAndRoot(() => card.create({ title: 'a' }))

    expect(kept).toEqual([])
  })

  test('a job\'s run is a trace that says which run, and finds the trace that told its event by its id', async () => {
    const card = cards()
    let fails = 1
    base.bus.subscribe('card.created', async () => {
      if (fails-- > 0) throw new Error('mailer down')
      await card.create({ title: 'from the job' })
    }, { mode: 'handler', name: 'card.create.on.card.created' })
    const told = { name: 'card.created', occurredAt: new Date().toISOString(), payload: {} }
    await enableAndRoot(() => base.store.transaction(() => base.publisher.publish(told as never)))
    await base.jobs.idle()
    await Bun.sleep(10)
    await base.jobs.idle()

    const [publishing, first, second] = kept
    expect(publishing!.told).toHaveLength(1)
    expect(first).toMatchObject({ kind: 'job', name: 'card.create.on.card.created', outcome: { kind: 'failure', code: 'Error' }, job: { run: 1, event: 'card.created', eventId: publishing!.told[0] } })
    expect(second).toMatchObject({ kind: 'job', retried: true, outcome: null, job: { run: 2 } })
  })

  test('traces nothing until it is turned on', async () => {
    applicationTraces.enabled = false
    const card = cards()
    await enableAndRoot(() => card.create({ title: 'a' }), false)

    expect(kept).toEqual([])
  })
})

describe('a query\'s shape', () => {
  test('says its fields and operators, its groups, its order and limit, never a value', () => {
    type Product = { workspaceId: string, archived: boolean, priceCents: number, brandId: string | null, skipped: string, name: string }
    expect(queryShape<Product>({ workspaceId: 'w', archived: false, or: [{ priceCents: { lt: 500 } }, { brandId: null }], skipped: undefined }, { orderBy: [{ field: 'name' }], limit: 10 }))
      .toBe('{workspaceId, archived, or({priceCents lt}, {brandId null})} order name limit 10')
    expect(queryShape(undefined)).toBe('{}')
  })
})

describe('MemoryTraces', () => {
  test('gives the traces of the minutes closed, whole, a page at a time', async () => {
    const traces = new MemoryTraces()
    const trace = (id: string) => ({ id, startedAt: new Date().toISOString(), ms: 3 }) as Trace
    traces.record(trace('a'))
    traces.record(trace('b'))
    const now = new Date()

    expect((await traces.closed(null, now)).traces).toEqual([])
    const later = new Date(now.getTime() + 60_000)
    const closed = await traces.closed(null, later, 1)
    expect(closed.traces.map(each => each.id)).toEqual(['a', 'b'])
    expect((await traces.closed(closed.until, later)).traces).toEqual([])
  })

  test('is what serving the monitor turns on, unless the application set its own', () => {
    applicationTraces.sink = null
    expect(enableTraces()).toBeInstanceOf(MemoryTraces)
  })
})

/** Runs `fn` as the root of a trace, as a request would. */
async function enableAndRoot<T>(fn: () => Promise<T>, on = true): Promise<T> {
  const { traceRoot } = await import('../../core/internal')
  if (on) applicationTraces.enabled = true
  return traceRoot({ kind: 'http', name: 'POST /test' }, fn)
}
