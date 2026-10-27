import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { StructureChangedDTO, StructureVersionDTO } from './structure'

let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string
let changes: StructureChangedDTO[]

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('shop', { order: { useCases: ['place'], events: ['placed'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  changes = []
  monitor.modules.structure.events.changed.subscribe(change => void changes.push(change), { strategy: 'fire-and-forget' })
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const refresh = () => monitor.modules.structure.refresh(id)
const versions = async () => ((await (await as(`/api/apps/${id}/structure/versions`)).json()) as { items: { id: string }[] }).items

describe('structure', () => {
  test('reads what an application is made of, and keeps it as its first version', async () => {
    const refreshed = await refresh()

    expect(refreshed.outcome).toBe('changed')
    const latest = await (await as(`/api/apps/${id}/structure`)).json() as StructureVersionDTO
    expect(latest.id).toBe(refreshed.version!.id)
    expect(latest.description.contexts[0]!.modules.map(module => module.id)).toEqual(['shop/order'])
    expect(changes).toEqual([{ appId: id, versionId: latest.id, previousVersionId: null }])
  })

  test('keeps no new version of the same structure, and tells nothing', async () => {
    const first = await refresh()

    expect(await refresh()).toEqual({ appId: id, outcome: 'unchanged', version: first.version! })
    expect(await versions()).toHaveLength(1)
    expect(changes).toHaveLength(1)
  })

  test('keeps a new version each time it changes, back to one it was too', async () => {
    const first = await refresh()
    app.add('billing', { invoice: { useCases: ['open'] } })
    const second = await refresh()
    app.remove('billing')
    const third = await refresh()

    expect([second.outcome, third.outcome]).toEqual(['changed', 'changed'])
    expect(third.version!.hash).toBe(first.version!.hash)
    expect((await versions()).map(version => version.id)).toEqual([third.version!.id, second.version!.id, first.version!.id])
    expect(changes.map(change => change.previousVersionId)).toEqual([null, first.version!.id, second.version!.id])
    const old = await (await as(`/api/apps/${id}/structure/versions/${second.version!.id}`)).json() as StructureVersionDTO
    expect(old.description.contexts.map(context => context.name)).toEqual(['shop', 'billing'])
  })

  test('keeps the last version of one that does not answer, and says why', async () => {
    const first = await refresh()
    await app.stop()

    expect(await refresh()).toMatchObject({ outcome: 'unreachable', version: first.version!, failure: { reason: 'unreachable' } })
    expect(await monitor.modules.connection.status(id)).toMatchObject({ status: 'down' })
  })

  test('takes one version however many refreshes run at once', async () => {
    const refreshed = await Promise.all(Array.from({ length: 5 }, refresh))

    expect(refreshed.filter(each => each.outcome === 'changed')).toHaveLength(1)
    expect(await versions()).toHaveLength(1)
  })

  test('has nothing to show before it first reads one', async () => {
    const response = await as(`/api/apps/${id}/structure`)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'structure.not_read' })
    expect((await as(`/api/apps/${Bun.randomUUIDv7()}/structure/versions`)).status).toBe(404)
  })
})
