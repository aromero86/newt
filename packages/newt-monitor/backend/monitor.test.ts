import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { readConfig } from './config'
import { openTestMonitor, type TestMonitor } from './testing/open-test-monitor'

let monitor: TestMonitor | undefined

afterEach(async () => {
  await monitor?.close()
  monitor = undefined
})

describe('the monitor', () => {
  test('is up, and says so without a session', async () => {
    monitor = await openTestMonitor()

    expect((await monitor.fetch('/api/health')).status).toBe(200)
  })

  test('answers a 404 for anything else it does not have', async () => {
    monitor = await openTestMonitor()

    expect((await monitor.fetch('/api/nowhere')).status).toBe(404)
  })

  test('hands its frontend every other address, and says so while it is not built', async () => {
    monitor = await openTestMonitor()

    const page = await monitor.fetch('/apps/cooper')
    expect(page.status).toBe(503)
    expect(await page.text()).toContain('not built')
  })
})

describe('its settings', () => {
  const required = { NEWT_MONITOR_USER: 'ana', NEWT_MONITOR_PASSWORD: 'twelve chars at least', NEWT_MONITOR_SECRET: 'a secret of thirty-two characters' }

  test('have what development needs by default, but who signs in', () => {
    expect(readConfig(required)).toEqual({
      port: 4800,
      database: 'data/newt-monitor.db',
      authDatabase: 'data/newt-monitor-auth.db',
      publicUrl: 'http://localhost:4800',
      admin: { user: 'ana', password: 'twelve chars at least' },
      sessionHours: 12,
      secret: 'a secret of thirty-two characters',
      frontend: join(import.meta.dir, '../dist/frontend'),
      frontendSources: false,
      metricsFolder: 'data/metrics',
      githubToken: null,
    })
  })

  test('stop it before it starts, naming every variable that is wrong', () => {
    expect(() => readConfig({ NEWT_MONITOR_PORT: 'eighty', NEWT_MONITOR_DATA: ' ' })).toThrow(/NEWT_MONITOR_PORT[\s\S]*NEWT_MONITOR_DATA/)
  })

  test('take an empty port for none, not port 0', () => {
    expect(readConfig({ ...required, NEWT_MONITOR_PORT: '' }).port).toBe(4800)
  })

  test('keep the public URL without its trailing slash, as every address is built on it', () => {
    expect(readConfig({ ...required, NEWT_MONITOR_PUBLIC_URL: 'https://m.example.com/' }).publicUrl).toBe('https://m.example.com')
  })

  test('have no user, password nor secret unless told: a monitor nobody configured does not start', () => {
    expect(() => readConfig({})).toThrow(/NEWT_MONITOR_USER[\s\S]*NEWT_MONITOR_PASSWORD[\s\S]*NEWT_MONITOR_SECRET/)
    expect(() => readConfig({ ...required, NEWT_MONITOR_SECRET: 'too short' })).toThrow(/NEWT_MONITOR_SECRET/)
    expect(() => readConfig({ ...required, NEWT_MONITOR_PASSWORD: 'short' })).toThrow(/NEWT_MONITOR_PASSWORD/)
  })
})
