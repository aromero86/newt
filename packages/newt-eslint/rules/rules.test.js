import { afterAll, describe, it } from 'bun:test'
import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
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
  ],
  invalid: [
    { code: "import { Product_Repository } from '../product/product.repository'", filename: `${MODULE}/price-change.module.ts`, errors: [{ messageId: 'private' }] },
    { code: "import { Product } from '../product/product'", filename: `${MODULE}/price-change.ts`, errors: [{ messageId: 'private' }] },
    { code: "export * from '../product/infrastructure/product.table'", filename: `${MODULE}/price-change.ts`, errors: [{ messageId: 'private' }] },
    { code: "import { Product_Repository } from '../product/product.repository'", filename: '/repo/examples/shop/modules/order/order.module.ts', errors: [{ messageId: 'private' }] },
  ],
})

const WORKERS = `${MODULE}/price-change.workers.ts`
tester.run('queue-name', queueName, {
  valid: [
    { code: "deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'priceChange.record.on.product.updated' })", filename: WORKERS },
    { code: "deps.product.events.updated.subscribe(async ({ changes: changed, dto }) => { if (changed.priceCents) await changes.record(dto) }, { strategy: 'handler', queue: 'priceChange.record.on.product.updated' })", filename: WORKERS },
    { code: "deps.product.events.updated.subscribe(() => cache.clear(), { strategy: 'fire-and-forget' })", filename: WORKERS },
  ],
  invalid: [
    { code: "deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'product.record.on.product.updated' })", filename: WORKERS, errors: [{ messageId: 'module' }] },
    { code: "deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'priceChange.remember.on.product.updated' })", filename: WORKERS, errors: [{ messageId: 'useCase' }] },
    { code: "deps.product.events.updated.subscribe(({ dto }) => changes.record(dto), { strategy: 'handler', queue: 'priceChange.record.on.product.created' })", filename: WORKERS, errors: [{ messageId: 'event' }] },
  ],
})
