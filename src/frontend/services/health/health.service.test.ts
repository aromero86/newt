import { afterEach, describe, expect, test } from 'bun:test'
import { Injector } from '../../core/injector/injector'
import { HealthService } from './health.service'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

/** A fresh injector per test, so each one builds its own service. */
const service = () => new Injector(new Injector(), [HealthService]).get(HealthService)

describe('HealthService', () => {
  test('is up when the backend answers', async () => {
    globalThis.fetch = (async () => Response.json({ status: 'ok' })) as unknown as typeof fetch
    const health = service()

    await health.check()

    expect(health.health.value).toBe('up')
  })

  test('is down when it does not', async () => {
    globalThis.fetch = (async () => new Response('', { status: 502 })) as unknown as typeof fetch
    const health = service()

    await health.check()

    expect(health.health.value).toBe('down')
  })
})
