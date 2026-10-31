import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { EventSource, Json } from 'newt/core'
import { freePort, type Browser } from 'newt/testing'
import { KeyCipher } from '../../../../shared/key-cipher'
import { openTestMonitor, TEST_SECRET, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { AppRow } from './app.repository'

let monitor: TestMonitor
let as: Browser
let cooper: TestApp
let COOPER: { name: string, url: string, key: string }

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
  cooper = serveTestApp('cooper')
  COOPER = { name: 'cooper', url: `${cooper.url}/`, key: cooper.key }
})

afterEach(async () => {
  await cooper.stop()
  await monitor.close()
})

const register = (json: unknown) => as('/api/apps', { method: 'POST', json })

describe('app', () => {
  test('registers an application, and never shows its key', async () => {
    const response = await register(COOPER)

    expect(response.status).toBe(201)
    const app = await response.json() as Record<string, unknown>
    expect(app).toMatchObject({ name: 'cooper', url: cooper.url, archivedAt: null })
    expect(Object.keys(app).sort()).toEqual(['archivedAt', 'createdAt', 'id', 'name', 'repository', 'updatedAt', 'url'])
    expect(await (await as(`/api/apps/${app.id}`)).json()).toEqual(app)
  })

  test('keeps the key sealed in its row, never as it was given', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }

    const [row] = await monitor.monitor.base.store.table<AppRow>('app').find({ id })
    expect(row!.sealedKey).toStartWith('v1.')
    expect(row!.sealedKey).not.toContain(COOPER.key)
  })

  test('lists them, the newest first', async () => {
    await register(COOPER)
    await register({ ...COOPER, name: 'nuke' })

    const page = await (await as('/api/apps')).json() as { items: { name: string }[] }
    expect(page.items.map(app => app.name)).toEqual(['nuke', 'cooper'])
  })

  test('refuses a name another application has, whatever the case, even at once', async () => {
    const answers = await Promise.all([register(COOPER), register({ ...COOPER, name: 'COOPER' })])

    expect(answers.map(answer => answer.status).sort()).toEqual([201, 409])
    expect(await answers.find(answer => answer.status === 409)!.json()).toMatchObject({ code: 'app.name_taken' })
  })

  test('refuses an address that is no http one, and a key too short to sign with', async () => {
    for (const json of [{ ...COOPER, url: 'ftp://cooper' }, { ...COOPER, url: 'http://cooper:3010/?x=1' }, { ...COOPER, key: 'short' }]) {
      expect((await register(json)).status).toBe(400)
    }
  })

  test('changes its name, its address or its key, and seals the new key', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }
    const moved = serveTestApp('cooper')

    const changed = await as(`/api/apps/${id}`, { method: 'PATCH', json: { name: 'Cooper', url: moved.url } })
    expect(await changed.json()).toMatchObject({ name: 'Cooper', url: moved.url })
    const [row] = await monitor.monitor.base.store.table<AppRow>('app').find({ id })
    expect(row!.sealedKey).not.toContain(moved.key)
    expect((await as(`/api/apps/${id}`, { method: 'PATCH', json: {} })).status).toBe(400)
    await moved.stop()
  })

  test('takes its key again when the one it keeps no longer opens, sealed with another secret', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }
    const table = monitor.monitor.base.store.table<AppRow>('app')
    await table.patch(id, { sealedKey: new KeyCipher('another secret, the one it was sealed with').seal(COOPER.key, id) })

    expect((await as(`/api/apps/${id}`, { method: 'PATCH', json: { key: COOPER.key } })).status).toBe(200)
    const [row] = await table.find({ id })
    expect(new KeyCipher(TEST_SECRET).open(row!.sealedKey, id)).toBe(COOPER.key)
  })

  test('asks for its key with a new address when the one it keeps no longer opens', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }
    await monitor.monitor.base.store.table<AppRow>('app').patch(id, { sealedKey: new KeyCipher('another secret, the one it was sealed with').seal(COOPER.key, id) })
    const moved = serveTestApp('cooper')

    const refused = await as(`/api/apps/${id}`, { method: 'PATCH', json: { url: moved.url } })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: 'app.key_unreadable' })
    expect(await (await as(`/api/apps/${id}`)).json()).toMatchObject({ url: cooper.url })
    await moved.stop()
  })

  test('says there is none for an id it does not have', async () => {
    const response = await as(`/api/apps/${Bun.randomUUIDv7()}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'app.not_found' })
  })

  test('shows nothing to anyone not signed in', async () => {
    expect((await monitor.fetch('/api/apps')).status).toBe(401)
  })
})

describe('an application\'s life', () => {
  const registered = async (name = 'cooper') => (await (await register({ ...COOPER, name })).json() as { id: string }).id
  const names = async (query = '') => ((await (await as(`/api/apps${query}`)).json()) as { items: { name: string }[] }).items.map(app => app.name)

  test('archived, it leaves the list of those watched, and is kept, with all of it', async () => {
    const id = await registered()
    await registered('nuke')

    const archived = await (await as(`/api/apps/${id}/archive`, { method: 'POST' })).json() as { archivedAt: string | null }
    expect(archived.archivedAt).not.toBeNull()
    expect(await names()).toEqual(['nuke'])
    expect(await names('?status=archived')).toEqual(['cooper'])
    expect(await names('?status=all')).toEqual(['nuke', 'cooper'])
    expect((await as(`/api/apps/${id}`)).status).toBe(200)
  })

  test('restored, it is watched again', async () => {
    const id = await registered()
    await as(`/api/apps/${id}/archive`, { method: 'POST' })

    expect(await (await as(`/api/apps/${id}/restore`, { method: 'POST' })).json()).toMatchObject({ archivedAt: null })
    expect(await names()).toEqual(['cooper'])
  })

  test('is deleted only once archived, and then for good', async () => {
    const id = await registered()

    const refused = await as(`/api/apps/${id}`, { method: 'DELETE' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: 'app.not_archived' })

    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    expect((await as(`/api/apps/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await as(`/api/apps/${id}`)).status).toBe(404)
    expect(await monitor.monitor.base.store.table<AppRow>('app').find({ id })).toEqual([])
  })

  test('tells each step, and nothing for a step it was already at', async () => {
    const told: string[] = []
    for (const [key, emitter] of Object.entries(monitor.modules.app.events) as [string, EventSource<Json>][]) {
      emitter.subscribe(() => void told.push(key), { strategy: 'fire-and-forget' })
    }
    const id = await registered()

    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}/restore`, { method: 'POST' })
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}`, { method: 'DELETE' })

    expect(told).toEqual(['registered', 'archived', 'restored', 'archived', 'deleted'])
  })
})

describe('an application that does not connect', () => {
  const nobody = () => `http://127.0.0.1:${freePort()}`

  test('is not registered, and the answer says why', async () => {
    const answers = [
      await register({ ...COOPER, url: nobody() }),
      await register({ ...COOPER, key: 'not cooper\'s key, though long enough' }),
    ]

    expect(answers.map(answer => answer.status)).toEqual([400, 400])
    expect(await Promise.all(answers.map(async answer => ((await answer.json()) as { code: string }).code))).toEqual(['app.unreachable', 'app.key_rejected'])
    expect(await monitor.monitor.base.store.table<AppRow>('app').find()).toEqual([])
  })

  test('is not where one is moved: the address and key that answered stay', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }

    const refused = await as(`/api/apps/${id}`, { method: 'PATCH', json: { url: nobody() } })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: 'app.unreachable' })
    expect((await as(`/api/apps/${id}`, { method: 'PATCH', json: { key: 'not cooper\'s key, though long enough' } })).status).toBe(400)
    expect(await (await as(`/api/apps/${id}`)).json()).toMatchObject({ url: cooper.url })
    expect(await monitor.modules.app.endpointOf(id)).toEqual({ url: cooper.url, key: cooper.key })
  })

  test('is checked only when its address or key changes: a new name asks nothing', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }
    await cooper.stop()

    expect((await as(`/api/apps/${id}`, { method: 'PATCH', json: { name: 'cooper (old)' } })).status).toBe(200)
  })
})
