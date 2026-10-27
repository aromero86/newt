import { afterEach, describe, expect, test } from 'bun:test'
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
})

describe('its settings', () => {
  test('have what development needs by default', () => {
    expect(readConfig({})).toEqual({ port: 4800, database: 'data/newt-monitor.db' })
  })

  test('stop it before it starts, naming every variable that is wrong', () => {
    expect(() => readConfig({ NEWT_MONITOR_PORT: 'eighty', NEWT_MONITOR_DATA: ' ' })).toThrow(/NEWT_MONITOR_PORT[\s\S]*NEWT_MONITOR_DATA/)
  })
})
