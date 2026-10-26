import { describe, expect, test } from 'bun:test'
import { systemClock, type EventBus } from '../../core'
import { Invocations } from '../../core/internal'
import type { Store, Table } from '../../port-store'
import { Schedules } from './schedules'

/** Schedules on a store whose one table keeps its rows in a list, and logs what is written to it. */
function setup() {
  const log: string[] = []
  const rows: { id: string, dueAt: string, version: number }[] = []
  const table = {
    find: async () => [...rows],
    insert: async (row: { id: string, dueAt: string }) => {
      log.push(`insert ${row.id}`)
      rows.push({ ...row, version: 1 })
    },
  } as unknown as Table<never>
  const store = { transaction: (fn: () => unknown) => Promise.resolve(fn()), table: () => table } as unknown as Store
  const bus: EventBus = { publish: () => {}, subscribe: () => () => {} }
  const schedules = new Schedules(store, bus, bus, new Invocations(), systemClock)
  return { schedules, log }
}

describe('Schedules.define', () => {
  test('gives an event named after the schedule, to subscribe to', () => {
    expect(setup().schedules.define('report.nightly', '0 3 * * *').name).toBe('report.nightly')
  })

  test('refuses a name not made as an event is, one taken, and a cron expression that is wrong or never due', () => {
    const { schedules } = setup()
    schedules.define('report.nightly', '0 3 * * *')

    expect(() => schedules.define('nightly', '0 3 * * *')).toThrow("'<module>.<name>'")
    expect(() => schedules.define('Report.nightly', '0 3 * * *')).toThrow("'<module>.<name>'")
    expect(() => schedules.define('report.nightly', '0 4 * * *')).toThrow('defined already')
    expect(() => schedules.define('report.weekly', '0 3 * *')).toThrow('five fields')
    expect(() => schedules.define('report.never', '0 0 31 2 *')).toThrow('never due')
  })
})

describe('Schedules.start', () => {
  test('looks at once, then waits for the next tick; stopped, it looks no more', async () => {
    const { schedules, log } = setup()
    schedules.define('report.nightly', '0 3 * * *')

    schedules.start()
    await Bun.sleep(5)
    await schedules.stop()

    expect(log).toEqual(['insert report.nightly'])
  })
})
