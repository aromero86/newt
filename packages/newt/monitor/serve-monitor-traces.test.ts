import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { SqliteStore } from '../adapter-sqlite'
import { Module, UseCase } from '../core'
import { applicationTraces, traceRoot } from '../core/internal'
import { Base, MemoryTraces, setTraces, type ClosedTraces } from '../runtime'
import { serveMonitor } from './serve-monitor'
import { signMonitorRequest } from './sign-monitor-request'

const KEY = 'a key both sides share, long enough'
let server: Server<undefined> | undefined
let base: Base | undefined

afterEach(async () => {
  await server?.stop(true)
  await base?.close()
  Object.assign(applicationTraces, { sink: null, sampleRate: 0.01, enabled: false })
})

describe('serveMonitor, with traces', () => {
  test('turns the application\'s traces on, and gives those of the minutes closed', async () => {
    // Another test's monitor may have turned them on: this one starts with them off.
    applicationTraces.enabled = false
    setTraces(new MemoryTraces(), { sampleRate: 1 })
    base = new Base({ name: 'shop', store: await SqliteStore.open({ path: ':memory:' }) })
    class Order_Module extends Module {
      constructor() {
        super('order', base!.invocations)
      }

      @UseCase()
      async place() {}
    }
    const orders = new Order_Module()
    // Before it serves, nothing is traced.
    await traceRoot({ kind: 'http', name: 'POST /orders' }, () => orders.place())
    server = serveMonitor([base], { name: 'shop-app', port: 0, key: KEY })
    await traceRoot({ kind: 'http', name: 'POST /orders' }, () => orders.place())

    const later = new Date(Date.now() + 61_000)
    const url = `${server.url.origin}/v1/traces`
    const response = await fetch(url, { headers: signMonitorRequest(KEY, { url, now: new Date() }) })
    const now = await response.json() as ClosedTraces
    expect(now.traces).toEqual([])
    const closed = await (applicationTraces.sink as MemoryTraces).closed(null, later)
    expect(closed.traces.map(trace => [trace.name, trace.useCases])).toEqual([['POST /orders', ['order.place']]])
  })
})
