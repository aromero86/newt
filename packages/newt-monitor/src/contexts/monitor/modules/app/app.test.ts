import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
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
    expect(app).toMatchObject({ name: 'cooper', url: 'http://cooper:3010' })
    expect(Object.keys(app).sort()).toEqual(['createdAt', 'id', 'name', 'updatedAt', 'url'])
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
