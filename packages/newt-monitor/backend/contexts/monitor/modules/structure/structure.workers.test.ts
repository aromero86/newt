import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from '@newt-kit/newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { RefreshDTO } from './structure'

const HOUR_MS = 60 * 60_000

let time: number
const clock = { now: () => new Date(time) }
let monitor: TestMonitor
let as: Browser
let apps: TestApp[]

beforeEach(async () => {
  time = Date.parse('2026-01-01T09:30:00Z')
  monitor = await openTestMonitor({ clock })
  as = await monitor.signedIn()
  apps = []
})

afterEach(async () => {
  for (const app of apps) await app.stop()
  await monitor.close()
})

const settled = () => monitor.monitor.base.jobs.idle()
const versions = async (id: string) => ((await (await as(`/api/apps/${id}/structure/versions`)).json()) as { items: unknown[] }).items.length

/** An application served for the test, registered, and read the first time. */
async function registered(name: string) {
  const app = serveTestApp(name)
  apps.push(app)
  app.add(name, { order: { useCases: ['place'] } })
  const { id } = await (await as('/api/apps', { method: 'POST', json: { name, url: app.url, key: app.key } })).json() as { id: string }
  await settled()
  return { app, id }
}

describe('reading the structure', () => {
  test('happens every hour, on the hour, for every application watched', async () => {
    // Its own loop stopped, once its first look, as the monitor started, is done: the
    // test ticks by hand. That first look told nothing of before: the next tick is ten's.
    await monitor.monitor.base.schedules.stop()
    const shop = await registered('shop')
    const nuke = await registered('nuke')
    const old = await registered('old')
    await as(`/api/apps/${old.id}/archive`, { method: 'POST' })
    for (const { app } of [shop, nuke, old]) app.add('billing', { invoice: { useCases: ['open'] } })

    time += HOUR_MS
    await monitor.monitor.base.schedules.tick()
    await settled()

    expect([await versions(shop.id), await versions(nuke.id), await versions(old.id)]).toEqual([2, 2, 1])
  })

  test('happens when the button asks, and says what it came to', async () => {
    const { app, id } = await registered('shop')
    const refresh = async () => (await (await as(`/api/apps/${id}/structure/refresh`, { method: 'POST' })).json()) as RefreshDTO

    expect((await refresh()).outcome).toBe('unchanged')
    app.add('billing', { invoice: { useCases: ['open'] } })
    expect((await refresh()).outcome).toBe('changed')
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    expect((await refresh()).outcome).toBe('archived')
  })

  test('happens as an application is restored, or moved to another address', async () => {
    const { app, id } = await registered('shop')
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    app.add('billing', { invoice: { useCases: ['open'] } })

    await as(`/api/apps/${id}/restore`, { method: 'POST' })
    await settled()
    expect(await versions(id)).toBe(2)

    const moved = serveTestApp('shop')
    apps.push(moved)
    moved.add('shop', { order: { useCases: ['place', 'cancel'] } })
    await as(`/api/apps/${id}`, { method: 'PATCH', json: { url: moved.url } })
    await settled()
    expect(await versions(id)).toBe(3)

    // A new name is no reason to read it again.
    await as(`/api/apps/${id}`, { method: 'PATCH', json: { name: 'Shop' } })
    await settled()
    expect(await versions(id)).toBe(3)
  })
})
