import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { EventSource, Json } from 'newt/core'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import type { AppRow } from './app.repository'

const COOPER = { name: 'cooper', url: 'http://cooper:3010/', key: 'cooper\'s monitor key, long enough to sign' }

let monitor: TestMonitor
let as: Browser

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
})

afterEach(() => monitor.close())

const register = (json: unknown) => as('/api/apps', { method: 'POST', json })

describe('app', () => {
  test('registers an application, and never shows its key', async () => {
    const response = await register(COOPER)

    expect(response.status).toBe(201)
    const app = await response.json() as Record<string, unknown>
    expect(app).toMatchObject({ name: 'cooper', url: 'http://cooper:3010', archivedAt: null })
    expect(Object.keys(app).sort()).toEqual(['archivedAt', 'createdAt', 'id', 'name', 'updatedAt', 'url'])
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

    const changed = await as(`/api/apps/${id}`, { method: 'PATCH', json: { url: 'https://cooper.internal:3010', key: 'another key for cooper, just as long' } })
    expect(await changed.json()).toMatchObject({ name: 'cooper', url: 'https://cooper.internal:3010' })
    const [row] = await monitor.monitor.base.store.table<AppRow>('app').find({ id })
    expect(row!.sealedKey).not.toContain('another key')
    expect((await as(`/api/apps/${id}`, { method: 'PATCH', json: {} })).status).toBe(400)
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
