import { afterAll, describe, expect, it } from 'bun:test'
import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { assertUsesTree, contextBoundaries } from './context-boundaries.js'
import { moduleAnatomy } from './module-anatomy.js'
import { moduleBoundaries } from './module-boundaries.js'
import { queueName } from './queue-name.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.afterAll = afterAll
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } })

const MODULE = '/repo/src/contexts/ws/modules/price-change'

tester.run('module-anatomy', moduleAnatomy, {
  valid: [
    ...['price-change.module.ts', 'price-change.ts', 'price-change.schema.ts', 'price-change.repository.ts', 'price-change.workers.ts', 'price-change-options.ts', 'price-change.test.ts', 'events/price-change-recorded.ts', 'errors/price-not-found.ts', 'services/price-rounding.ts']
      .map(file => ({ code: '', filename: `${MODULE}/${file}` })),
    { code: '', filename: '/repo/src/contexts/ws/ws.context.ts' },
    { code: '', filename: '/repo/examples/shop/modules/order/order.workers.ts' },
  ],
  invalid: [
    { code: '', filename: `${MODULE}/helpers.ts`, errors: [{ messageId: 'file' }] },
    { code: '', filename: `${MODULE}/utils/format.ts`, errors: [{ messageId: 'folder' }] },
    { code: '', filename: `${MODULE}/infrastructure/price-change.table.ts`, errors: [{ messageId: 'folder' }] },
    { code: '', filename: `${MODULE}/events/recorded.ts`, errors: [{ messageId: 'event' }] },
    ...['constructor', 'toString', '__proto__'].map(folder => ({ code: '', filename: `${MODULE}/${folder}/x.ts`, errors: [{ messageId: 'folder' }] })),
    { code: '', filename: `${process.cwd()}/modules/order/helpers.ts`, errors: [{ messageId: 'file' }] },
  ],
})

tester.run('module-boundaries', moduleBoundaries, {
  valid: [
    { code: "import type { Product_Module } from '../product/product.module'", filename: `${MODULE}/price-change.deps.ts` },
    { code: "import { ProductNotFound } from '../product/errors/product-not-found'", filename: `${MODULE}/price-change.module.ts` },
    { code: "import type { ProductDTO } from '../product/product.schema'", filename: `${MODULE}/price-change.ts` },
    { code: "import type { User_Module } from '../../../auth/modules/user/user.module'", filename: `${MODULE}/price-change.deps.ts` },
    { code: "import { PriceChange } from './price-change'", filename: `${MODULE}/price-change.repository.ts` },
    { code: "import type { Product_Module } from '../product/product.module'", filename: '/repo/examples/shop/modules/order/order.deps.ts' },
    { code: "import type { Product_Module } from '../product/product.module.js'", filename: `${MODULE}/price-change.deps.ts` },
    { code: "import type { ProductDTO } from '../product/product.schema.js'", filename: `${MODULE}/price-change.ts` },
    { code: "import { Product_Created } from '../product/events/product-created.js'", filename: `${MODULE}/price-change.workers.ts` },
    { code: "type M = import('../product/product.module').Product_Module", filename: `${MODULE}/price-change.ts` },
  ],
  invalid: [
    { code: "import { Product_Repository } from '../product/product.repository'", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
    { code: "import { Product } from '../product/product'", filename: `${MODULE}/price-change.ts`, errors: [{ messageId: 'private' }] },
    { code: "export * from '../product/infrastructure/product.table'", filename: `${MODULE}/price-change.ts`, errors: [{ messageId: 'private' }] },
    { code: "import { Product_Repository } from '../product/product.repository'", filename: '/repo/examples/shop/modules/order/order.module.ts', errors: [{ messageId: 'private' }] },
    { code: "import { Product_Repository } from '../product/product.repository.js'", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
    { code: "import { Product_Repository } from '../product'", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
    { code: "const { Product_Repository } = await import('../product/product.repository')", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
    { code: "type R = import('../product/product.repository').Product_Repository", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
    { code: "import R = require('../product/product.repository')", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
    { code: "const R = require('../product/product.repository')", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
  ],
})

const CONTEXTS = { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } }
const CONTEXT = `${process.cwd()}/src/contexts`
tester.run('context-boundaries', contextBoundaries, {
  valid: [
    { code: "import { x } from '../auth/auth.context'", filename: `${CONTEXT}/shop/shop.context.ts`, options: [CONTEXTS] },
    { code: "import { x } from '../shop/shop.module'", filename: `${CONTEXT}/auth/modules/user/user.module.ts`, options: [CONTEXTS] },
    { code: "import { x } from './modules/user/user.module'", filename: `${CONTEXT}/auth/auth.context.ts`, options: [CONTEXTS] },
  ],
  invalid: [
    ...["'../shop/shop.context'", "'./../shop/shop.context'", "'../../contexts/shop/shop.context'", "'../shop'"]
      .map(path => ({ code: `import { x } from ${path}`, filename: `${CONTEXT}/auth/auth.context.ts`, options: [CONTEXTS], errors: [{ messageId: 'other' }] })),
    { code: "const m = await import('../shop/shop.context')", filename: `${CONTEXT}/auth/auth.context.ts`, options: [CONTEXTS], errors: [{ messageId: 'other' }] },
    { code: "import { x } from '../shop/shop.context'", filename: `${CONTEXT}/billing/billing.context.ts`, options: [CONTEXTS], errors: [{ messageId: 'other' }] },
  ],
})

describe('the contexts a preset says', () => {
  it('make a tree, of contexts it lists', () => {
    expect(() => assertUsesTree({ auth: [], shop: ['auth'], cs: ['auth', 'shop'] })).not.toThrow()
    expect(() => assertUsesTree({ auth: ['shop'], shop: ['auth'] })).toThrow('auth → shop → auth')
    expect(() => assertUsesTree({ auth: ['auth'] })).toThrow('auth → auth')
    expect(() => assertUsesTree({ shop: ['auth'] })).toThrow("the context 'shop' uses 'auth', which is not in `uses`")
  })
})

const WORKERS = `${MODULE}/price-change.workers.ts`
const ORDER = '/repo/src/contexts/shop/modules/order'
tester.run('queue-name', queueName, {
  valid: [
    { code: "(changes: PriceChange_Module) => deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'priceChange.record.on.product.updated' })", filename: WORKERS },
    { code: "(changes: PriceChange_Module) => deps.product.events.updated.subscribe(async ({ changes: changed, dto }) => { if (changed.priceCents) await changes.record(dto) }, { strategy: 'handler', queue: 'priceChange.record.on.product.updated' })", filename: WORKERS },
    { code: "deps.product.events.updated.subscribe(() => cache.clear(), { strategy: 'fire-and-forget' })", filename: WORKERS },
    { code: "orders.events.placed.subscribe(o => orders.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.workers.ts` },
    { code: "async function onPlaced(o) { await orders.fulfil(o.id) }\norders.events.placed.subscribe(onPlaced, { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.workers.ts` },
    { code: "orders.events.placed.subscribe(orders.fulfilPlaced.bind(orders), { strategy: 'handler', queue: 'order.fulfilPlaced.on.order.placed' })", filename: `${ORDER}/order.workers.ts` },
    { code: "this.events.placed.subscribe(o => this.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.module.ts` },
  ],
  invalid: [
    { code: "(changes: PriceChange_Module) => deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'product.record.on.product.updated' })", filename: WORKERS, errors: [{ messageId: 'module' }] },
    { code: "(changes: PriceChange_Module) => deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'priceChange.remember.on.product.updated' })", filename: WORKERS, errors: [{ messageId: 'useCase' }] },
    { code: "(changes: PriceChange_Module) => deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'priceChange.record.on.product.created' })", filename: WORKERS, errors: [{ messageId: 'event' }] },
    ...['order', 'order.fulfil', 'order.fulfil.now.on.order.placed', 'order.fulfil.on.placed']
      .map(queue => ({ code: `orders.events.placed.subscribe(o => orders.fulfil(o.id), { strategy: 'handler', queue: '${queue}' })`, filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'shape' }] })),
    { code: "orders.events.placed.subscribe(o => products.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'useCase' }] },
    { code: "(orders: Order_Module, products: Product_Module) => orders.events.placed.subscribe(o => products.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'useCase' }] },
    { code: "(orders: Order_Module, deps: Order_Deps) => orders.events.placed.subscribe(o => deps.product.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'useCase' }] },
    { code: "this.events.placed.subscribe(o => this.fulfil(o.id), { strategy: 'handler', queue: 'mail.fulfil.on.order.placed' })", filename: `${ORDER}/order.module.ts`, errors: [{ messageId: 'module' }] },
  ],
})
