import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ApiError, Requester } from 'newt-react'
import { openTestMonitor, TEST_ADMIN, type TestMonitor } from '../../src/testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../src/testing/serve-test-app'
import { AppApi } from './app'
import { CatalogApi } from './catalog'
import { ConnectionApi } from './connection'
import { SessionApi } from './session'
import { StructureApi } from './structure'

// The clients against the monitor itself, as the browser runs them: the same routes,
// the session's cookie sent with every request.
const originalFetch = globalThis.fetch
let monitor: TestMonitor
let shop: TestApp
let cookie = ''

beforeAll(async () => {
  monitor = await openTestMonitor()
  shop = serveTestApp()
  shop.add('shop', { order: { useCases: ['place'], events: ['placed'] } })
  Requester.baseUrl = `${monitor.url}/api`
  // Only what goes to the monitor carries the cookie: its own calls to the application go as they are.
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    if (typeof url !== 'string' || !url.startsWith(monitor.url)) return originalFetch(url, init)
    const response = await originalFetch(url, { ...init, headers: { ...init.headers as Record<string, string>, cookie } })
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie
    return response
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  Requester.baseUrl = '/api'
  await shop.stop()
  await monitor.close()
})

describe('the API clients', () => {
  const sessions = new SessionApi()
  const apps = new AppApi()

  test('sign in, and a wrong password is a 401 with its code', async () => {
    const wrong = await sessions.signIn({ user: TEST_ADMIN.user, password: 'not the password' }).catch((error: unknown) => error)
    expect(wrong).toBeInstanceOf(ApiError)
    expect(wrong).toMatchObject({ status: 401, code: 'session.wrong_credentials' })

    expect(await sessions.signIn(TEST_ADMIN)).toEqual({ user: TEST_ADMIN.user })
    expect(await sessions.me()).toEqual({ user: TEST_ADMIN.user })
  })

  test('register, read, refresh and catalog an application', async () => {
    const app = await apps.register({ name: 'shop', url: shop.url, key: shop.key })
    expect((await apps.list()).items.map(each => each.name)).toEqual(['shop'])
    expect(await new ConnectionApi().check(app.id)).toMatchObject({ status: 'up' })
    // Registering read its first version already, in a job.
    await monitor.monitor.base.jobs.idle()

    const structures = new StructureApi()
    expect(await structures.refresh(app.id)).toMatchObject({ outcome: 'unchanged' })
    const latest = await structures.latest(app.id)
    expect(latest.description.contexts.map(context => context.name)).toEqual(['shop'])
    expect((await structures.versions(app.id)).items.map(version => version.id)).toEqual([latest.id])

    const useCases = await new CatalogApi().list(app.id, { kind: 'useCase' })
    expect(useCases.items.map(item => item.itemId)).toEqual(['shop/order.place'])
  })

  test('archive before deleting', async () => {
    const [app] = (await apps.list()).items
    expect(await apps.remove(app!.id).catch((error: ApiError) => error.code)).toBe('app.not_archived')
    await apps.archive(app!.id)
    expect((await apps.list('archived')).items).toHaveLength(1)
    await apps.remove(app!.id)
    expect((await apps.list('all')).items).toHaveLength(0)
  })

  test('sign out: then every request is a 401', async () => {
    await sessions.signOut()
    expect(await sessions.me().catch((error: ApiError) => error.status)).toBe(401)
  })
})
