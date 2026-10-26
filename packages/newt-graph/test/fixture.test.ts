import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { analyze } from '../src/extract/analyze'
import type { Graph } from '../src/model'

const root = join(import.meta.dir, 'fixture', 'app')
const graph = analyze({ root, base: root })

const edges = (g: Graph, kind: string) => g.edges.filter(edge => edge.kind === kind).map(edge => `${edge.from} -> ${edge.to}`).sort()

describe('a tiny application of two contexts', () => {
  test('finds its contexts by the name each one gives its Base', () => {
    expect(graph.contexts.map(each => each.id)).toEqual(['billing', 'shop'])
    expect(graph.contexts.find(each => each.id === 'shop')).toMatchObject({ file: 'contexts/shop/shop.context.ts', line: 6 })
  })

  test('finds each module in the context it is initialized in, and leaves fakes out', () => {
    expect(graph.modules.map(each => each.id).sort()).toEqual(['billing/invoice', 'shop/order', 'shop/product'])
    expect(graph.modules.find(each => each.id === 'shop/order')).toMatchObject({
      className: 'Order_Module',
      file: 'contexts/shop/modules/order/order.module.ts',
      initializedAt: { file: 'contexts/shop/initialize-modules.ts', line: 7 },
      test: false,
    })
  })

  test('finds the use cases, with their writesTo and retries', () => {
    expect(graph.useCases.map(each => each.id).sort()).toEqual([
      'billing/invoice.issue', 'billing/invoice.remind',
      'shop/order.cancel', 'shop/order.confirm', 'shop/order.place', 'shop/order.total',
      'shop/product.get', 'shop/product.reserve',
    ])
    expect(graph.useCases.find(each => each.id === 'shop/order.cancel')).toMatchObject({ writesTo: ['product'], retryOnConflict: false, line: 33 })
  })

  test('follows calls through this, deps and a port of another context', () => {
    expect(edges(graph, 'calls')).toEqual([
      'billing/invoice.issue -> shop/order.total',
      'shop/order.cancel -> shop/product.reserve',
      'shop/order.place -> shop/product.get',
      'shop/product.reserve -> shop/product.get',
    ])
    expect(graph.edges.find(edge => edge.from === 'billing/invoice.issue' && edge.kind === 'calls')?.via).toBe('Orders.total')
  })

  test('finds the events a use case tells, through the helpers it calls', () => {
    expect(edges(graph, 'emits')).toEqual([
      'billing/invoice.issue -> billing/invoice.issued',
      'shop/order.cancel -> shop/order.cancelled',
      'shop/order.place -> shop/order.placed',
    ])
    // Told in a private helper: the location is where the event is made.
    expect(graph.edges.find(edge => edge.id === 'emits:shop/order.place->shop/order.placed')).toMatchObject({ file: 'contexts/shop/modules/order/order.module.ts', line: 49 })
  })

  test('finds every subscription, the context whose worker runs it, and its schedule', () => {
    expect(graph.subscriptions.map(({ id, event, strategy, handlers, runsIn, attempts, queue }) => ({ id, event, strategy, handlers, runsIn, attempts, queue }))).toEqual([
      { id: 'shop/order.confirm.on.order.placed', event: 'shop/order.placed', strategy: 'handler', handlers: ['shop/order.confirm'], runsIn: 'shop', attempts: 5, queue: 'order.confirm.on.order.placed' },
      { id: 'billing/invoice.issue.on.order.placed', event: 'shop/order.placed', strategy: 'handler', handlers: ['billing/invoice.issue'], runsIn: 'shop', attempts: 7, queue: 'invoice.issue.on.order.placed' },
      { id: 'billing/invoice.remind.on.invoice.nightly', event: 'billing/invoice.nightly', strategy: 'handler', handlers: ['billing/invoice.remind'], runsIn: 'billing', attempts: 5, queue: 'invoice.remind.on.invoice.nightly' },
      { id: 'billing/invoice.on.invoice.issued:8', event: 'billing/invoice.issued', strategy: 'fire-and-forget', handlers: [], runsIn: 'billing', attempts: null, queue: null },
    ])
    expect(graph.events.find(each => each.id === 'billing/invoice.nightly')?.schedule).toEqual({ cron: '0 2 * * *' })
    expect(edges(graph, 'triggers')).toEqual([
      'billing/invoice.nightly -> billing/invoice.remind',
      'shop/order.placed -> billing/invoice.issue',
      'shop/order.placed -> shop/order.confirm',
    ])
  })

  test('finds routes with their router\'s prefix, and what each one calls', () => {
    expect(graph.routes).toEqual([
      { id: 'shop/GET /api/products/:id', method: 'GET', path: '/api/products/:id', module: 'shop/product', context: 'shop', useCases: ['shop/product.get'], file: 'contexts/shop/modules/product/product.routes.ts', line: 5 },
    ])
  })

  test('reads what each module is given: modules, and ports with what is behind them', () => {
    expect(graph.modules.find(each => each.id === 'billing/invoice')?.deps).toEqual([
      { name: 'orders', kind: 'port', target: null, file: 'contexts/billing/modules/invoice/invoice.deps.ts', line: 14 },
      { name: 'orderEvents', kind: 'port', target: 'shop/order', file: 'contexts/billing/modules/invoice/invoice.deps.ts', line: 15 },
    ])
    expect(edges(graph, 'depends')).toEqual(['billing/invoice -> shop/order', 'shop/order -> shop/product'])
    expect(graph.warnings).toEqual([])
  })

  test('reads tests and fakes when asked, marked as such', () => {
    const withTests = analyze({ root, base: root, tests: true })
    expect(withTests.modules.find(each => each.id === 'shop/fakeProduct')).toMatchObject({ test: true })
    expect(withTests.app.tests).toBe(true)
  })
})
