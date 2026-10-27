import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { ConnectionStatusDTO } from './connection'

let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string
let told: string[]

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('shop', { order: { useCases: ['place'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  told = []
  monitor.modules.connection.events.lost.subscribe(({ failure }) => void told.push(`lost: ${failure?.reason}`), { strategy: 'fire-and-forget' })
  monitor.modules.connection.events.restored.subscribe(() => void told.push('restored'), { strategy: 'fire-and-forget' })
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const check = async () => (await as(`/api/apps/${id}/connection/check`, { method: 'POST' })).json() as Promise<ConnectionStatusDTO>
const status = async () => (await as(`/api/apps/${id}/connection`)).json() as Promise<ConnectionStatusDTO>

describe('connection', () => {
  test('knows nothing of an application until it asks it', async () => {
    expect(await status()).toMatchObject({ status: 'unknown', lastSeenAt: null })
  })

  test('asks an application which it is, signing with its key, and records that it answered', async () => {
    const checked = await check()

    expect(checked).toMatchObject({ status: 'up', failure: null, identity: { name: 'shop', instance: { pid: process.pid } } })
    expect(checked.lastSeenAt).toBe(checked.checkedAt)
    expect(await status()).toEqual(checked)
    expect(told).toEqual([])
  })

  test('records why it did not answer, tells it is lost, and that it is back', async () => {
    await check()
    await app.stop()

    const down = await check()
    expect(down).toMatchObject({ status: 'down', failure: { reason: 'unreachable' } })
    // Down, it keeps who it was and when it last answered.
    expect(down.identity).toMatchObject({ name: 'shop' })
    expect(down.lastSeenAt).not.toBeNull()

    app.start()
    expect(await check()).toMatchObject({ status: 'up' })
    expect(told).toEqual(['lost: unreachable', 'restored'])
  })

  test('tells it lost an application that stopped answering, once however many times it asks', async () => {
    await check()
    await app.stop()

    expect(await check()).toMatchObject({ status: 'down', failure: { reason: 'unreachable' } })
    await check()
    expect(told).toEqual(['lost: unreachable'])
  })

  test('says there is no application for an id it does not have, and nothing to nobody signed in', async () => {
    expect((await as(`/api/apps/${Bun.randomUUIDv7()}/connection`)).status).toBe(404)
    expect((await monitor.fetch(`/api/apps/${id}/connection`)).status).toBe(401)
  })
})
