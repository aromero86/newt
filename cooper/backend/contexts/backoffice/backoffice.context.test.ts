import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { openTestBackoffice, type TestBackoffice } from './testing/open-test-backoffice'

describe('the backoffice API', () => {
  let t: TestBackoffice
  let server: Server<undefined>

  beforeEach(async () => {
    t = await openTestBackoffice()
    // Who asks, by a header: the real authenticator reads the web session's cookie (shared/web-session tests it).
    t.backoffice.base.http.authenticateWith(async request => {
      const userId = request.headers.get('x-user')
      return userId ? { userId, via: 'web' as const } : null
    })
    server = t.backoffice.serve()
  })

  afterEach(async () => {
    await server.stop()
    await t.close()
  })

  const get = (path: string, userId?: string) => fetch(new URL(path, server.url), { headers: userId ? { 'x-user': userId } : {} })

  test('answers only the staff: 401 without a session, 403 to anyone else, at once after a revoke', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.staffMember('Ana')

    for (const path of ['/api/session', '/api/workspaces', '/api/users', '/api/staff', '/api/metrics']) {
      expect((await get(path)).status).toBe(401)
      expect((await get(path, ana.id)).status).toBe(200)
    }
    expect(await (await get('/api/session', ana.id)).json()).toMatchObject({ user: { id: ana.id, name: 'Ana', email: 'ana@cooper.test' } })

    await t.as(sam, () => t.modules.staff.revoke(ana.id))
    for (const path of ['/api/session', '/api/workspaces', '/api/users/' + sam.id, '/api/staff', '/api/metrics']) {
      const response = await get(path, ana.id)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'staff.not_staff' })
    }
  })

  test('says what is not there with a 404, to the staff', async () => {
    const sam = await t.staffMember('Sam')
    expect((await get('/api/workspaces/0190a0a0-0000-7000-8000-000000000000', sam.id)).status).toBe(404)
    expect((await get('/api/users/0190a0a0-0000-7000-8000-000000000000', sam.id)).status).toBe(404)
  })
})
