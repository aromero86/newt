import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Shop_Context, type ShopConfig } from './shop.context'

type Mail = { to: string, subject: string }

const stores: [string, (folder: string) => ShopConfig['store']][] = [
  ['files', folder => ({ kind: 'files', folder })],
  ['SQLite', folder => ({ kind: 'sqlite', path: join(folder, 'shop.db') })],
]

describe.each(stores)('the shop, on %s', (_, store) => {
  let folder: string
  let shop: Shop_Context
  let server: ReturnType<Shop_Context['serve']>
  let mails: Mail[]

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'despensa-'))
    mails = []
    shop = await Shop_Context.open({ store: store(folder), mailer: { send: async mail => { mails.push({ to: mail.to, subject: mail.subject }) } } })
    server = shop.serve(0)
    shop.start()
  })

  afterEach(async () => {
    await server.stop()
    await shop.stop()
    await rm(folder, { recursive: true })
  })

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, user = 'ana') => {
    const response = await fetch(new URL(`/api${path}`, server.url), { method, headers: { 'x-user': user, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
  }
  const product = async (name: string, priceCents = 250, refs: { brandId?: string, categoryId?: string } = {}) => (await call<{ id: string }>('POST', '/products', { name, priceCents, ...refs })).body.id
  const level = async (productId: string) => (await call<{ level: number }>('GET', `/stock/${productId}`)).body.level
  // The email as a person types it, with a capital and a space: the order keeps it clean.
  const order = (productId: string, quantity: number, user = 'ana') => call<{ id: string, status: string, totalCents: number }>('POST', '/orders', { customerEmail: ` ${user}@Shop.test`, lines: [{ productId, quantity }] }, user)
  /** Until the background work is done: the jobs the commits wrote, run. */
  const settled = () => shop.base.jobs.idle()

  test('keeps a catalog, with names no two products share', async () => {
    await product('Olive oil')

    expect((await call('POST', '/products', { name: 'OLIVE OIL', priceCents: 1 })).status).toBe(409)
    expect((await call<{ items: { name: string }[] }>('GET', '/products')).body.items.map(item => item.name)).toEqual(['Olive oil'])
  })

  test('takes an order at once, and confirms it in the background', async () => {
    const oil = await product('Olive oil', 1_000)
    await call('POST', `/stock/${oil}/received`, { quantity: 5 })

    const placed = await order(oil, 3)
    expect(placed.status).toBe(202)
    expect(placed.body).toMatchObject({ status: 'pending', totalCents: 3_000 })

    await settled()
    expect((await call('GET', `/orders/${placed.body.id}`)).body).toMatchObject({ status: 'confirmed' })
    expect(await level(oil)).toBe(2)
    expect(mails).toEqual([{ to: 'ana@shop.test', subject: 'Your order is confirmed' }])
  })

  test('rejects an order there is not enough stock for, and says why', async () => {
    const oil = await product('Olive oil')
    await call('POST', `/stock/${oil}/received`, { quantity: 2 })

    const placed = await order(oil, 3)
    await settled()

    expect((await call('GET', `/orders/${placed.body.id}`)).body).toMatchObject({ status: 'rejected', rejection: expect.stringContaining('not enough stock') })
    expect(await level(oil)).toBe(2)
    expect(mails.map(mail => mail.subject)).toEqual(['We could not take your order'])
  })

  test('gives the last units to one of two orders placed at once', async () => {
    const oil = await product('Olive oil')
    await call('POST', `/stock/${oil}/received`, { quantity: 3 })

    const placed = await Promise.all([order(oil, 2, 'ana'), order(oil, 2, 'bea')])
    await settled()

    const statuses = await Promise.all(placed.map((each, i) => call<{ status: string }>('GET', `/orders/${each.body.id}`, undefined, ['ana', 'bea'][i])))
    expect(statuses.map(each => each.body.status).sort()).toEqual(['confirmed', 'rejected'])
    expect(await level(oil)).toBe(1)
  })

  test('fulfils an order once, however many times its work runs', async () => {
    const oil = await product('Olive oil')
    await call('POST', `/stock/${oil}/received`, { quantity: 5 })
    const placed = await order(oil, 2)
    await settled()

    // As a job retried after it did its work: nothing more happens.
    await shop.modules.order.fulfil(placed.body.id)
    await shop.modules.stockMovement.reserve([{ productId: oil, quantity: 2 }], placed.body.id)

    expect(await level(oil)).toBe(3)
  })

  test('reserves and gives back once, even when the same work runs twice at once', async () => {
    const oil = await product('Olive oil')
    await call('POST', `/stock/${oil}/received`, { quantity: 5 })
    const stock = shop.modules.stockMovement

    await Promise.all([stock.reserve([{ productId: oil, quantity: 2 }], 'order-1'), stock.reserve([{ productId: oil, quantity: 2 }], 'order-1')])
    expect(await level(oil)).toBe(3)

    await Promise.all([stock.release('order-1'), stock.release('order-1')])
    expect(await level(oil)).toBe(5)
  })

  test('refuses an order of a product it does not know, or no longer sells', async () => {
    const oil = await product('Olive oil')
    await call('PATCH', `/products/${oil}`, { archived: true })

    expect((await order('nope', 1)).body).toMatchObject({ code: 'reference_not_found' })
    expect((await order(oil, 1)).body).toMatchObject({ code: 'order.product_not_for_sale' })
  })

  test('shows each customer only their own orders, and nobody unsigned anything', async () => {
    const oil = await product('Olive oil')
    const placed = await order(oil, 1)

    expect((await call('GET', `/orders/${placed.body.id}`, undefined, 'bea')).status).toBe(404)
    expect((await call('GET', '/orders', undefined, '')).status).toBe(401)
  })

  test('points products at a brand and a category, which must exist, and forgets them once deleted', async () => {
    const acme = (await call<{ id: string }>('POST', '/brands', { name: 'Acme' })).body.id
    const oils = (await call<{ id: string }>('POST', '/categories', { name: 'Oils' })).body.id
    const oil = await product('Olive oil', 1_000, { brandId: acme, categoryId: oils })
    expect((await call('GET', '/brands')).body).toMatchObject({ items: [{ id: acme, name: 'Acme' }], hasMore: false, total: 1 })
    expect((await call('GET', `/categories/${oils}`)).body).toMatchObject({ name: 'Oils' })

    expect((await call('POST', '/products', { name: 'Ghost', priceCents: 1, brandId: 'nope' })).body).toMatchObject({ code: 'reference_not_found' })

    expect((await call('DELETE', `/brands/${acme}`)).status).toBe(204)
    expect((await call('GET', `/brands/${acme}`)).status).toBe(404)
    await settled()
    expect((await call('GET', `/products/${oil}`)).body).toMatchObject({ brandId: null, categoryId: oils })
  })

  test('searches with the filter it allows, in groups, and refuses anything else', async () => {
    const acme = (await call<{ id: string }>('POST', '/brands', { name: 'Acme' })).body.id
    await product('Olive oil', 1_000, { brandId: acme })
    await product('Salt', 90)
    await product('Saffron', 4_000)
    const names = async (filter: unknown) => (await call<{ items: { name: string }[] }>('POST', '/products/search', filter)).body.items.map(item => item.name).sort()

    expect(await names({ or: [{ field: 'price', op: 'lt', value: 100 }, { field: 'brand', op: 'eq', value: acme }] })).toEqual(['Olive oil', 'Salt'])
    expect(await names({ and: [{ field: 'price', op: 'gte', value: 100 }, { field: 'name', op: 'ieq', value: 'SAFFRON' }] })).toEqual(['Saffron'])
    expect((await call('POST', '/products/search', { field: 'archived', op: 'eq', value: true })).status).toBe(400)
  })

  test('gives the stock back when an order is cancelled, once, however many times its work runs', async () => {
    const oil = await product('Olive oil')
    await call('POST', `/stock/${oil}/received`, { quantity: 5 })
    const placed = await order(oil, 3)
    await settled()
    expect(await level(oil)).toBe(2)

    expect((await call('POST', `/orders/${placed.body.id}/cancel`)).body).toMatchObject({ status: 'cancelled' })
    await settled()
    await shop.modules.order.releaseStock(placed.body.id)

    expect(await level(oil)).toBe(5)
  })

  test('tells each product change with the values it changed from', async () => {
    const oil = await product('Olive oil', 1_000)
    const told: unknown[] = []
    shop.modules.product.events.updated.subscribe(change => { told.push({ changes: change.changes, previous: change.previous }) }, { strategy: 'fire-and-forget' })

    await call('PATCH', `/products/${oil}`, { priceCents: 1_100 })
    await Bun.sleep(5)

    expect(told).toEqual([{ changes: { priceCents: 1_100 }, previous: { priceCents: 1_000 } }])
  })
})
