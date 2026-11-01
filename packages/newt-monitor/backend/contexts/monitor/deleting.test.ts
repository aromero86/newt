import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt-kit/testing'
import { openTestMonitor, type TestMonitor } from '../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../testing/serve-test-app'

let monitor: TestMonitor
let apps: TestApp[]
let as: Browser

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
  apps = []
})

afterEach(async () => {
  for (const app of apps) await app.stop()
  await monitor.close()
})

const settled = () => monitor.monitor.base.jobs.idle()

/** A row of a table whose rows are each an application's. */
type OfAnApp = { id: string, appId: string, version: number }

/** How many rows of each table are an application's. */
async function rowsOf(appId: string) {
  const { store } = monitor.monitor.base
  return {
    app: await store.table('app').count({ id: appId }),
    connection: await store.table<OfAnApp>('connection').count({ appId }),
    structure: await store.table<OfAnApp>('structure_version').count({ appId }),
    catalog: await store.table<OfAnApp>('catalog_item').count({ appId }),
  }
}

/** An application served, registered, asked, read twice and catalogued: 4 items, then 3 more. */
async function known(name = 'shop') {
  const app = serveTestApp(name)
  apps.push(app)
  app.add('shop', { order: { useCases: ['place'], events: ['placed'] } })
  const { id } = await (await as('/api/apps', { method: 'POST', json: { name, url: app.url, key: app.key } })).json() as { id: string }
  await as(`/api/apps/${id}/connection/check`, { method: 'POST' })
  await settled()
  app.add('billing', { invoice: { useCases: ['open'] } })
  await as(`/api/apps/${id}/structure/refresh`, { method: 'POST' })
  await settled()
  return id
}

describe('deleting an application', () => {
  test('takes everything the monitor knew of it, and nothing of another', async () => {
    const shop = await known('shop')
    const other = await known('other')
    expect(await rowsOf(shop)).toEqual({ app: 1, connection: 1, structure: 2, catalog: 7 })

    await as(`/api/apps/${shop}/archive`, { method: 'POST' })
    await as(`/api/apps/${shop}`, { method: 'DELETE' })
    await settled()

    expect(await rowsOf(shop)).toEqual({ app: 0, connection: 0, structure: 0, catalog: 0 })
    expect(await rowsOf(other)).toEqual({ app: 1, connection: 1, structure: 2, catalog: 7 })
  })

  test('keeps everything of it while it is only archived', async () => {
    const shop = await known()

    await as(`/api/apps/${shop}/archive`, { method: 'POST' })
    await settled()

    expect(await rowsOf(shop)).toEqual({ app: 1, connection: 1, structure: 2, catalog: 7 })
  })

  test('forgets it once however many times it is told, and a job told late finds nothing to do', async () => {
    const shop = await known()
    await as(`/api/apps/${shop}/archive`, { method: 'POST' })
    await as(`/api/apps/${shop}`, { method: 'DELETE' })
    await settled()
    const { connection, structure, catalog } = monitor.modules

    await connection.forget(shop)
    await structure.forget(shop)
    await catalog.forget(shop)
    expect(await structure.refresh(shop)).toEqual({ appId: shop, outcome: 'gone', version: null })
    await catalog.record(shop)

    expect(await rowsOf(shop)).toEqual({ app: 0, connection: 0, structure: 0, catalog: 0 })
    expect(await monitor.monitor.base.store.outbox.list({ status: 'dead' })).toEqual([])
  })
})
