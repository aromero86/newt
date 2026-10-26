import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from '../adapter-sqlite'
import { NotFoundError, type Clock } from '../core'
import { HttpRouter } from './http-router'
import type { KeptAnswer } from './kept-answer'

let folder: string
let store: SqliteStore
let server: Server<undefined>
let made: number
let gate: Promise<void> | null
let time: number
const clock: Clock = { now: () => new Date(time) }
const MINUTE = 60_000
const HOUR = 60 * MINUTE

class NothingToMake extends NotFoundError {
  readonly code = 'thing.nothing'
}

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'newt-idempotency-'))
  await Bun.write(join(folder, '00001_idempotency-key_up.sql'), 'CREATE TABLE idempotency_key (id TEXT PRIMARY KEY, version INTEGER NOT NULL, body_hash TEXT NOT NULL, status INTEGER NOT NULL, headers TEXT NOT NULL, body TEXT NOT NULL, expires_at TEXT NOT NULL); CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);')
  await Bun.write(join(folder, '00001_idempotency-key_down.sql'), 'DROP TABLE idempotency_key;')
})

afterAll(() => rm(folder, { recursive: true }))

beforeEach(async () => {
  store = await SqliteStore.open({ path: ':memory:', migrations: folder })
  made = 0
  gate = null
  time = Date.parse('2026-01-01T00:00:00.000Z')
  const router = new HttpRouter({ idempotency: { table: store.table<KeptAnswer>('idempotency_key'), ttlMs: HOUR, clock } })
  router.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId } : null
  })
  router.post('/things', async request => {
    const { name } = await request.json() as { name: string }
    if (gate) await gate
    if (name === 'nothing') throw new NothingToMake('Nothing to make')
    if (name === 'broken') return new Response('broken', { status: 503 })
    made++
    return Response.json({ number: made, name }, { status: 201, headers: { 'x-made': String(made) } })
  })
  router.put('/things', async () => Response.json({ number: ++made }))
  server = Bun.serve({ port: 0, routes: router.routes(), fetch: () => new Response('frontend') })
})

afterEach(async () => {
  await server.stop(true)
  await store.close()
})

const kept = () => store.table<KeptAnswer>('idempotency_key').count()

const post = (name: string, key?: string, user = 'ana', method = 'POST') => fetch(new URL('/api/things', server.url), {
  method,
  headers: { 'content-type': 'application/json', 'x-user': user, ...(key ? { 'idempotency-key': key } : {}) },
  body: JSON.stringify({ name }),
})

describe('idempotency', () => {
  test('a POST sent again with the same key gets the first answer, and does nothing again', async () => {
    const first = await post('Plan', 'key-1')
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ number: 1, name: 'Plan' })

    const again = await post('Plan', 'key-1')
    expect(again.status).toBe(201)
    expect(again.headers.get('x-made')).toBe('1')
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(await again.json()).toEqual({ number: 1, name: 'Plan' })
    expect(made).toBe(1)

    // Another key, another person, or no key at all: each is a request of its own.
    expect(await (await post('Plan', 'key-2')).json()).toMatchObject({ number: 2 })
    expect(await (await post('Plan', 'key-1', 'bob')).json()).toMatchObject({ number: 3 })
    expect(await (await post('Plan')).json()).toMatchObject({ number: 4 })
    expect(await (await post('Plan')).json()).toMatchObject({ number: 5 })
  })

  test('only a POST: any other method runs every time', async () => {
    await post('Plan', 'key-1', 'ana', 'PUT')
    await post('Plan', 'key-1', 'ana', 'PUT')
    expect(made).toBe(2)
  })

  test('a key is forgotten once it expires, by the clock it is given', async () => {
    await post('Plan', 'key-1')
    time += HOUR - 1
    expect(await (await post('Plan', 'key-1')).json()).toMatchObject({ number: 1 })
    time += 1
    expect(await (await post('Plan', 'key-1')).json()).toMatchObject({ number: 2 })
    expect(await (await post('Plan', 'key-1')).json()).toMatchObject({ number: 2 })
  })

  test('forgotten keys are removed as new ones come, at most once a minute: the table does not grow forever', async () => {
    await post('Plan', 'key-1')
    time += HOUR - MINUTE / 2
    await post('Plan', 'key-2')
    expect(await kept()).toBe(2)

    // key-1 is forgotten, but the last removal was half a minute ago: it is still there.
    time += MINUTE / 2
    await post('Plan', 'key-3')
    expect(await kept()).toBe(3)

    time += MINUTE / 2
    await post('Plan', 'key-4')
    expect(await kept()).toBe(3)
  })

  test('the same key with another body is a 422, and runs nothing', async () => {
    await post('Plan', 'key-1')
    const other = await post('Other', 'key-1')
    expect(other.status).toBe(422)
    expect(await other.json()).toMatchObject({ code: 'idempotency_key_reused' })
    expect(made).toBe(1)
  })

  test('what fails is not kept: the same key tries again', async () => {
    expect((await post('nothing', 'key-1')).status).toBe(404)
    expect((await post('broken', 'key-2')).status).toBe(503)
    expect((await post('Plan', 'key-1')).status).toBe(201)
    expect((await post('Plan', 'key-2')).status).toBe(201)
    expect(made).toBe(2)
  })

  test('the same key while the first is in progress is a 409', async () => {
    let open = () => {}
    gate = new Promise(resolve => { open = resolve })
    const first = post('Plan', 'key-1')
    await Bun.sleep(30)
    const second = await post('Plan', 'key-1')
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ code: 'idempotency_key_in_use' })
    open()
    expect((await first).status).toBe(201)
    expect(made).toBe(1)
  })

  test('a key in progress is held a minute at most: a process that died does not hold it for the whole day', async () => {
    let open = () => {}
    gate = new Promise(resolve => { open = resolve })
    const first = post('Plan', 'key-1')
    await Bun.sleep(30)
    gate = null
    time += MINUTE - 1
    expect((await post('Plan', 'key-1')).status).toBe(409)

    time += 1
    const second = await post('Plan', 'key-1')
    expect(second.status).toBe(201)
    expect(await second.json()).toMatchObject({ number: 1 })

    // The first ends at last: it answers, but the key is the second's now.
    open()
    expect(await (await first).json()).toMatchObject({ number: 2 })
    const again = await post('Plan', 'key-1')
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(await again.json()).toMatchObject({ number: 1 })
  })
})
