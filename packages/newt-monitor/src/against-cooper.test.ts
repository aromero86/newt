import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { freePort, type Browser } from 'newt/testing'
import type { CatalogItemDTO } from './contexts/monitor/modules/catalog/catalog'
import type { ConnectionStatusDTO } from './contexts/monitor/modules/connection/connection'
import type { StructureVersionDTO } from './contexts/monitor/modules/structure/structure'
import { openTestMonitor, type TestMonitor } from './testing/open-test-monitor'

/** The repository's root: cooper is beside the monitor's package. */
const ROOT = join(import.meta.dir, '../../..')
const COOPER_KEY = 'cooper\'s monitor key, for this test only'

let cooper: Bun.Subprocess<'ignore', 'pipe', 'inherit'>
let cooperMonitor: string
let monitor: TestMonitor
let as: Browser

/** Until cooper's output says its monitor endpoint listens. */
async function listening(process: typeof cooper): Promise<void> {
  const decoder = new TextDecoder()
  let output = ''
  for await (const chunk of process.stdout) {
    output += decoder.decode(chunk)
    if (output.includes('monitor listening')) return
  }
  throw new Error(`cooper stopped before its monitor listened:\n${output}`)
}

// cooper as it runs in production: its own process, every database in memory, its
// monitor endpoint on with a key. The monitor reaches it as it would reach any.
beforeAll(async () => {
  const port = freePort()
  cooperMonitor = `http://127.0.0.1:${port}`
  cooper = Bun.spawn(['bun', 'cooper/backend/index.ts'], {
    cwd: ROOT,
    stdout: 'pipe',
    env: {
      ...process.env,
      COOPER_AUTH_PORT: String(freePort()),
      COOPER_BOARDS_PORT: String(freePort()),
      COOPER_BACKOFFICE_PORT: String(freePort()),
      COOPER_AUTH_DATABASE: ':memory:',
      COOPER_BOARDS_DATABASE: ':memory:',
      COOPER_BACKOFFICE_DATABASE: ':memory:',
      COOPER_MONITOR_KEY: COOPER_KEY,
      COOPER_MONITOR_PORT: String(port),
    },
  })
  await listening(cooper)
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
}, 30_000)

afterAll(async () => {
  cooper.kill()
  await cooper.exited
  await monitor.close()
})

describe('the monitor, against cooper', () => {
  test('registers cooper, knows it answers, reads what it is made of, and catalogues it', async () => {
    const registered = await as('/api/apps', { method: 'POST', json: { name: 'cooper', url: cooperMonitor, key: COOPER_KEY } })
    expect(registered.status).toBe(201)
    const { id } = await registered.json() as { id: string }
    await monitor.monitor.base.jobs.idle()

    const connection = await (await as(`/api/apps/${id}/connection/check`, { method: 'POST' })).json() as ConnectionStatusDTO
    expect(connection).toMatchObject({ status: 'up', identity: { name: 'cooper' } })

    const structure = await (await as(`/api/apps/${id}/structure`)).json() as StructureVersionDTO
    expect(structure.description.contexts.map(context => [context.name, context.uses])).toEqual([['auth', []], ['boards', ['auth']], ['backoffice', ['auth', 'boards']]])

    const catalog = await (await as(`/api/apps/${id}/catalog?context=boards&module=card&kind=useCase&size=100`)).json() as { items: CatalogItemDTO[] }
    expect(catalog.items.map(item => item.itemId)).toContain('boards/card.create')
    const schedules = await (await as(`/api/apps/${id}/catalog?kind=event&size=100`)).json() as { items: CatalogItemDTO[] }
    expect(schedules.items.find(item => item.itemId === 'auth/session.nightly')?.details).toEqual({ schedule: { cron: '0 3 * * *' } })
  })

  test('is refused by cooper with any other key, and saves nothing', async () => {
    const refused = await as('/api/apps', { method: 'POST', json: { name: 'cooper (wrong)', url: cooperMonitor, key: 'not cooper\'s key, but just as long' } })

    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: 'app.key_rejected' })
  })
})
