import { afterAll, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli'
import type { Graph } from '../src/model'

const app = join(import.meta.dir, 'fixture', 'app')
const out = await mkdtemp(join(tmpdir(), 'newt-graph-'))
afterAll(() => rm(out, { recursive: true, force: true }))

test('--json writes the graph, files relative to where it runs', async () => {
  expect(await main(['--json', '--out', join(out, 'graph.json')], app)).toBe(0)
  const graph = await Bun.file(join(out, 'graph.json')).json() as Graph
  expect(graph.version).toBe(1)
  expect(graph.app).toMatchObject({ name: 'fixture', root: '.', tests: false, tsconfig: 'tsconfig.json' })
  expect(graph.modules.map(each => each.id).sort()).toEqual(['billing/invoice', 'shop/order', 'shop/product'])
})

test('--out writes one page that needs nothing else: its script, its style and the graph inside', async () => {
  const log = spyOn(console, 'log').mockImplementation(() => {})
  try {
    expect(await main(['--out', join(out, 'graph.html'), '--root', '.'], app)).toBe(0)
  } finally {
    log.mockRestore()
  }
  const html = await Bun.file(join(out, 'graph.html')).text()
  expect(html).toStartWith('<!doctype html>')
  expect(html).not.toContain('<script src=')
  expect(html).not.toContain('<link')
  const json = /<script type="application\/json" id="graph">(.*?)<\/script>/s.exec(html)?.[1]
  const graph = JSON.parse(json!) as Graph
  expect(graph.useCases.some(each => each.id === 'shop/order.place')).toBe(true)
  // Cytoscape is bundled in.
  expect(html.length).toBeGreaterThan(300_000)
})

test('--help says how', async () => {
  const log = spyOn(console, 'log').mockImplementation(() => {})
  try {
    expect(await main(['--help'], app)).toBe(0)
    expect(String(log.mock.calls[0]?.[0])).toContain('Usage: newt-graph')
  } finally {
    log.mockRestore()
  }
})
