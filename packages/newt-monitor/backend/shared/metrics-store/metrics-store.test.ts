import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppGone, MetricsStore } from './metrics-store'

let folder: string | undefined

afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true })
})

test('opens an application\'s DuckDB again once the process that held its lock lets it go, as in a deployment', async () => {
  folder = await mkdtemp(join(tmpdir(), 'metrics-store-'))
  const path = join(folder, 'app.duckdb')
  // The monitor going away: another process, with the file open.
  const holder = Bun.spawn(['bun', '-e', `
    const { DuckDbAnalytics } = await import('newt-kit/adapter-duckdb')
    await DuckDbAnalytics.open({ path: ${JSON.stringify(path)}, datasets: {} })
    console.log('open')
    await new Promise(() => {})
  `], { stdout: 'pipe', stderr: 'inherit' })
  const reader = holder.stdout.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('open')

  const store = new MetricsStore(folder)
  await expect(store.of('app')).rejects.toThrow(/lock/i)

  holder.kill()
  await holder.exited
  const analytics = await store.of('app')
  expect(await analytics.query<{ n: number }>('SELECT 1 AS n')).toEqual([{ n: 1 }])
  await store.close()
})

test('does not open again the DuckDB of an application it dropped: what comes late for it is not kept', async () => {
  folder = await mkdtemp(join(tmpdir(), 'metrics-store-'))
  const store = new MetricsStore(folder)
  store.define({ count: { columns: { n: 'INTEGER' } } })
  await store.of('app')
  await store.dropIfEmpty('app')

  await expect(store.of('app')).rejects.toBeInstanceOf(AppGone)
  expect(await Bun.file(join(folder, 'app.duckdb')).exists()).toBe(false)
  await store.close()
})
