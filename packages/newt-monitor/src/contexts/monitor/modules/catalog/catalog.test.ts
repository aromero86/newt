import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { CatalogItemDTO } from './catalog'
import type { CatalogItemRow } from './catalog.repository'

let time: number
const clock = { now: () => new Date(time) }
let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string

beforeEach(async () => {
  time = Date.parse('2026-01-01T09:00:00Z')
  monitor = await openTestMonitor({ clock })
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('shop', { order: { useCases: ['place', 'cancel'], events: ['placed'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  await settled()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const settled = () => monitor.monitor.base.jobs.idle()
const items = async (query = '') => ((await (await as(`/api/apps/${id}/catalog${query}`)).json()) as { items: CatalogItemDTO[] }).items
const ids = async (query = '') => (await items(query)).map(item => item.itemId)

/** A deployment, an hour later: the structure read again, and its catalog brought to it. */
async function deployed(change: () => void) {
  change()
  time += 60 * 60_000
  await monitor.modules.structure.refresh(id)
  await settled()
}

describe('catalog', () => {
  test('keeps every part of an application as its first version is read', async () => {
    expect(await ids()).toEqual(['shop', 'shop/order', 'shop/order.place', 'shop/order.cancel', 'shop/order.placed'])
    const [useCase] = await items('?kind=useCase')
    expect(useCase).toMatchObject({
      kind: 'useCase', context: 'shop', module: 'order', name: 'order.place',
      details: { writesTo: [], retryOnConflict: true },
      firstSeenAt: '2026-01-01T09:00:00.000Z', lastSeenAt: '2026-01-01T09:00:00.000Z', archivedAt: null,
    })
  })

  test('adds what a new version has, from when it appeared', async () => {
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))

    const billing = await items('?context=billing')
    expect(billing.map(item => item.itemId)).toEqual(['billing', 'billing/invoice', 'billing/invoice.open'])
    expect(billing.every(item => item.firstSeenAt === '2026-01-01T10:00:00.000Z')).toBe(true)
    // What was there and still is was seen again.
    expect((await items('?kind=context&context=shop'))[0]).toMatchObject({ firstSeenAt: '2026-01-01T09:00:00.000Z', lastSeenAt: '2026-01-01T10:00:00.000Z' })
  })

  test('archives what a new version no longer has, and loses none of it', async () => {
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))
    await deployed(() => app.remove('billing'))

    expect(await ids('?context=billing')).toEqual([])
    const gone = await items('?context=billing&status=archived')
    expect(gone.map(item => item.itemId)).toEqual(['billing', 'billing/invoice', 'billing/invoice.open'])
    expect(gone[0]).toMatchObject({ firstSeenAt: '2026-01-01T10:00:00.000Z', lastSeenAt: '2026-01-01T10:00:00.000Z', archivedAt: '2026-01-01T11:00:00.000Z' })
    expect(await ids('?status=all')).toHaveLength(8)
  })

  test('brings back what comes back, from when it first appeared', async () => {
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))
    await deployed(() => app.remove('billing'))
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))

    expect((await items('?context=billing'))[0]).toMatchObject({ firstSeenAt: '2026-01-01T10:00:00.000Z', lastSeenAt: '2026-01-01T12:00:00.000Z', archivedAt: null })
  })

  test('lists by kind, context and module', async () => {
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'], events: ['opened'] } }))

    expect(await ids('?kind=event')).toEqual(['shop/order.placed', 'billing/invoice.opened'])
    expect(await ids('?module=invoice&kind=useCase')).toEqual(['billing/invoice.open'])
    expect((await as(`/api/apps/${id}/catalog?kind=table`)).status).toBe(400)
  })

  test('comes to the same, however many times it is brought to the same version', async () => {
    const rows = () => monitor.monitor.base.store.table<CatalogItemRow>('catalog_item').find({ appId: id })
    const before = await rows()

    await monitor.modules.catalog.record(id)
    await monitor.modules.catalog.record(id)

    expect(await rows()).toEqual(before)
  })

  test('shows one item, and nothing of an application it does not have', async () => {
    const [first] = await items()

    expect(await (await as(`/api/apps/${id}/catalog/${first!.id}`)).json()).toEqual(first)
    expect((await as(`/api/apps/${Bun.randomUUIDv7()}/catalog`)).status).toBe(404)
  })
})
