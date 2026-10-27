import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { browser } from 'newt/testing'
import { openTestMonitor, TEST_ADMIN, type TestMonitor } from '../../../../testing/open-test-monitor'

let monitor: TestMonitor
let time: number
const clock = { now: () => new Date(time) }

beforeEach(async () => {
  time = Date.parse('2026-01-01T09:00:00Z')
  monitor = await openTestMonitor({ clock, sessionHours: 1 })
})

afterEach(() => monitor.close())

describe('session', () => {
  test('signs the admin in, and every route runs as them', async () => {
    const as = await monitor.signedIn()

    expect(await (await as('/api/session')).json()).toEqual({ user: 'ana' })
  })

  test('keeps the token in a cookie the page cannot read, sent to this origin only', async () => {
    const response = await monitor.fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(TEST_ADMIN) })

    const cookie = response.headers.getSetCookie()[0]!
    expect(cookie).toStartWith('newt_monitor_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('Secure')
  })

  test('refuses a wrong user or a wrong password the same way, saying neither', async () => {
    const as = browser(monitor.url)

    for (const json of [{ ...TEST_ADMIN, user: 'bea' }, { ...TEST_ADMIN, password: 'not the password' }]) {
      const response = await as('/api/session', { method: 'POST', json })
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: 'session.wrong_credentials' })
    }
    expect((await as('/api/session')).status).toBe(401)
  })

  test('answers a 401 to anyone with no session, or one signed out', async () => {
    expect((await monitor.fetch('/api/session')).status).toBe(401)

    const as = await monitor.signedIn()
    expect((await as('/api/session', { method: 'DELETE' })).status).toBe(204)
    expect((await as('/api/session')).status).toBe(401)
    // Signing out twice is signing out once.
    expect((await as('/api/session', { method: 'DELETE' })).status).toBe(204)
  })

  test('ends once its hours are up', async () => {
    const as = await monitor.signedIn()

    time += 59 * 60_000
    expect((await as('/api/session')).status).toBe(200)
    time += 60_000
    expect((await as('/api/session')).status).toBe(401)
  })
})
