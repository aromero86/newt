import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { analyze } from '../src/extract/analyze'
import { GraphIndex, type EdgeGroup } from '../src/page/client/graph-index'
import { computeView, type Granularity, type ViewState } from '../src/page/client/view'

const root = join(import.meta.dir, 'fixture', 'app')
const graph = analyze({ root, base: root, uses: { shop: [], billing: ['shop'] } })

const state = (granularity: Granularity, more: Partial<ViewState> = {}): ViewState => ({
  granularity,
  overrides: new Map(),
  hiddenContexts: new Set(),
  groups: new Set<EdgeGroup>(['calls', 'events', 'schedules', 'writesTo']),
  showTests: false,
  allowed: null,
  boundaries: false,
  ...more,
})

test('contexts only: one node each, their edges added up', () => {
  const view = computeView(new GraphIndex(graph), state('contexts'))
  expect(view.nodes.map(each => [each.id, each.collapsed, each.inside])).toEqual([['billing', true, 2], ['shop', true, 6]])
  expect(view.edges.map(each => [each.id, each.fine.length]).sort()).toEqual([
    ['calls|billing|shop', 1],
    ['events|shop|billing', 1],
  ])
})

test('modules: inside their contexts; one module opened in place shows its use cases', () => {
  const index = new GraphIndex(graph)
  const view = computeView(index, state('modules', { overrides: new Map([['shop/order', true]]) }))
  expect(view.nodes.filter(each => each.parent === 'shop/order').map(each => each.id).sort()).toEqual(['shop/order.cancel', 'shop/order.confirm', 'shop/order.place', 'shop/order.total'])
  expect(view.nodes.find(each => each.id === 'shop/product')).toMatchObject({ parent: 'shop', collapsed: true })
  expect(view.rep('shop/product.get')).toBe('shop/product')
  // Events are not drawn: a use case goes straight to the handlers of what it tells.
  expect(view.edges.some(each => each.id === 'events|shop/order.place|shop/order.confirm')).toBe(true)
})

test('+ events: events as nodes, told and handled', () => {
  const view = computeView(new GraphIndex(graph), state('events'))
  expect(view.nodes.find(each => each.id === 'shop/order.placed')).toMatchObject({ parent: 'shop/order' })
  expect(view.edges.map(each => each.id)).toContain('events|shop/order.place|shop/order.placed')
  expect(view.edges.map(each => each.id)).toContain('events|shop/order.placed|billing/invoice.issue')
  expect(view.edges.map(each => each.id)).toContain('schedules|billing/invoice.nightly|billing/invoice.remind')
})

test('filters: a context hidden, an edge kind left out, only some items', () => {
  const index = new GraphIndex(graph)
  expect(computeView(index, state('useCases', { hiddenContexts: new Set(['billing']) })).nodes.every(each => each.item.context === 'shop')).toBe(true)
  expect(computeView(index, state('useCases', { groups: new Set<EdgeGroup>(['calls']) })).edges.every(each => each.group === 'calls')).toBe(true)
  const only = computeView(index, state('useCases', { allowed: new Set(['shop/product.get']) }))
  expect(only.nodes.map(each => each.id).sort()).toEqual(['shop', 'shop/product', 'shop/product.get'])
})

test('a context that reaches one it does not say it uses is flagged', () => {
  const strict = { ...graph, contexts: graph.contexts.map(each => ({ ...each, uses: each.id === 'billing' ? [] : each.uses })) }
  const view = computeView(new GraphIndex(strict), state('contexts', { boundaries: true }))
  expect(view.edges.filter(each => each.violation).map(each => each.id).sort()).toEqual(['calls|billing|shop', 'events|shop|billing'])
  const allowed = computeView(new GraphIndex(graph), state('contexts', { boundaries: true }))
  expect(allowed.edges.filter(each => each.violation)).toEqual([])
  expect(allowed.edges.some(each => each.id === 'uses|billing|shop')).toBe(true)
})
