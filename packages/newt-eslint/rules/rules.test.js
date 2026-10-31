import { afterAll, describe, expect, it } from 'bun:test'
import { RuleTester } from 'eslint'
import ts from 'typescript'
import tseslint from 'typescript-eslint'
import { assertUsesTree, contextBoundaries } from './context-boundaries.js'
import { moduleAnatomy } from './module-anatomy.js'
import { moduleBoundaries } from './module-boundaries.js'
import { queueName } from './queue-name.js'
import { routeBody } from './route-body.js'
import { schemaImports } from './schema-imports.js'
import { useCase } from './use-case.js'

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
    { code: "export * from './modules/product/product.module'", filename: '/repo/src/contexts/ws/index.ts' },
    { code: "export { ProductNotFound } from './product/errors/product-not-found'", filename: '/repo/src/contexts/ws/modules/index.ts' },
    { code: "import { Product_Repository } from './modules/product/product.repository'", filename: '/repo/src/contexts/ws/ws.context.ts' },
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
    { code: "export * from './modules/product/product.repository'", filename: '/repo/src/contexts/ws/index.ts', errors: [{ messageId: 'barrel' }] },
    { code: "export { Product_Repository } from './product/product.repository'", filename: '/repo/src/contexts/ws/modules/index.ts', errors: [{ messageId: 'barrel' }] },
  ],
})

tester.run('schema-imports', schemaImports, {
  valid: [
    { code: "import { defineFilter, Email } from 'newt/contract'", filename: `${MODULE}/price-change.schema.ts` },
    { code: "import { z } from 'zod'", filename: `${MODULE}/price-change.schema.ts` },
    { code: "import type { ProductDTO } from '../product/product.schema'", filename: `${MODULE}/price-change.schema.ts` },
    { code: "import { Module } from 'newt/core'", filename: `${MODULE}/price-change.module.ts` },
    { code: "import { newtish } from 'newt-extras'", filename: `${MODULE}/price-change.schema.ts` },
  ],
  invalid: [
    { code: "import { ValidationError } from 'newt/core'", filename: `${MODULE}/price-change.schema.ts`, errors: [{ messageId: 'server' }] },
    { code: "import type { Page } from 'newt/core'", filename: `${MODULE}/price-change.schema.ts`, errors: [{ messageId: 'server' }] },
    { code: "export * from 'newt/runtime'", filename: `${MODULE}/price-change.schema.ts`, errors: [{ messageId: 'server' }] },
    { code: "const core = await import('newt/core')", filename: '/repo/examples/shop/modules/order/order.schema.ts', errors: [{ messageId: 'server' }] },
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
    { code: "(orders: m.Order_Module) => orders.events.placed.subscribe(o => orders.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.workers.ts` },
    { code: "class W { constructor(private readonly orders: Order_Module) {} register() { this.orders.events.placed.subscribe(o => this.orders.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' }) } }", filename: `${ORDER}/order.workers.ts` },
    { code: "class Order_Module { register() { this.events.placed.subscribe(o => this.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' }) } }", filename: `${ORDER}/order.workers.ts` },
    // Without a program, only a key of `events` says the event: a schedule's field is not its name.
    { code: "orders.purgeSchedule.subscribe(() => orders.purge(), { strategy: 'handler', queue: 'order.purge.on.order.nightly' })", filename: `${ORDER}/order.workers.ts` },
    ...[['category', 'categories'], ['address', 'addresses'], ['box', 'boxes'], ['batch', 'batches']].map(([module, plural]) => ({
      code: `deps.brand.events.deleted.subscribe(b => ${plural}.forget(b.id), { strategy: 'handler', queue: '${module}.forget.on.brand.deleted' })`,
      filename: `/repo/src/contexts/shop/modules/${module}/${module}.workers.ts`,
    })),
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
    { code: "orders.events.placed.subscribe(o => orders.fulfil(o.id), { strategy: 'handler' as const, queue: 'order.bad' })", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'shape' }] },
    { code: "orders.events.placed.subscribe(o => orders.fulfil(o.id), { strategy: 'handler' satisfies string, queue: 'order.bad' })", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'shape' }] },
    { code: "(orders: m.Product_Module) => orders.events.placed.subscribe(o => orders.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'useCase' }] },
    { code: "class W { register() { this.orders.events.placed.subscribe(o => this.products.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' }) } }", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'useCase' }] },
    { code: "class W { constructor(private readonly orders: Product_Module) {} register() { this.orders.events.placed.subscribe(o => this.orders.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' }) } }", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'useCase' }] },
    // A queue written as a template, or with what only TypeScript sees around it.
    ...["`mail.fulfil.on.order.placed`", "<const>'mail.fulfil.on.order.placed'", "'mail.fulfil.on.order.placed'!"]
      .map(queue => ({ code: `orders.events.placed.subscribe(o => orders.fulfil(o.id), { strategy: \`handler\`, queue: ${queue} })`, filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'module' }] })),
    // `this` in a class of the workers is that class, not the module.
    { code: "class W { fulfil(id) {} register(orders) { orders.events.placed.subscribe(o => this.fulfil(o.id), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' }) } }", filename: `${ORDER}/order.workers.ts`, errors: [{ messageId: 'useCase' }] },
  ],
})

/** A program of `files` (path to code) and what they import, as the preset has typescript-eslint build one. */
function programOf(files) {
  const options = { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true }
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile
  host.getSourceFile = (name, ...rest) => (name in files ? ts.createSourceFile(name, files[name], options.target, true) : read(name, ...rest))
  host.fileExists = name => name in files || ts.sys.fileExists(name)
  host.readFile = name => files[name] ?? ts.sys.readFile(name)
  host.directoryExists = folder => Object.keys(files).some(file => file.startsWith(`${folder}/`)) || ts.sys.directoryExists(folder)
  return ts.createProgram(Object.keys(files), options, host)
}

const ORDER_TYPED = `${ORDER}/order.module.ts`
const typedModule = `
declare class Emitter { subscribe(handler: (payload: unknown) => unknown, subscription: { strategy: string, queue: string }): () => void }
declare function eventsOf<C>(bus: unknown, classes: C): { readonly [K in keyof C]: Emitter }
declare const base: { bus: unknown, schedules: { define(name: string, cron: string): Emitter } }
export class Order_Placed { static readonly eventName = 'order.placed' }
export class Order_Module {
  readonly events = eventsOf(base.bus, { added: Order_Placed })
  readonly purgeSchedule
  constructor() {
    this.purgeSchedule = base.schedules.define('order.nightly', '0 3 * * *')
    this.events.added.subscribe(() => this.fulfil('x'), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })
  }
  fulfil(id: string) {}
  purge() {}
}
`
const typedCases = [
  // The event is its class's name, or its schedule's, whatever the key it is read from.
  ["export const w = (orders: Order_Module) => orders.events.added.subscribe(() => orders.fulfil('x'), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })"],
  ["export const w = (orders: Order_Module) => orders.purgeSchedule.subscribe(() => orders.purge(), { strategy: 'handler', queue: 'order.purge.on.order.nightly' })"],
  ["export const w = (orders: Order_Module) => orders.events.added.subscribe(() => orders.fulfil('x'), { strategy: 'handler', queue: 'order.fulfil.on.order.added' })", 'event'],
  ["export const w = (orders: Order_Module) => orders.purgeSchedule.subscribe(() => orders.purge(), { strategy: 'handler', queue: 'order.purge.on.order.purgeSchedule' })", 'event'],
  ["export class W { fulfil(id: string) {} register(orders: Order_Module) { orders.events.added.subscribe(() => this.fulfil('x'), { strategy: 'handler', queue: 'order.fulfil.on.order.placed' }) } }", 'useCase'],
].map(([code, error], index) => ({ code: `import type { Order_Module } from './order.module'\n${code}`, filename: `${ORDER}/order${index}.workers.ts`, error }))
const typedProgram = programOf({ [ORDER_TYPED]: typedModule, ...Object.fromEntries(typedCases.map(({ filename, code }) => [filename, code])) })

new RuleTester({ languageOptions: { parser: tseslint.parser, parserOptions: { programs: [typedProgram] } } }).run('queue-name, typed', queueName, {
  valid: [{ code: typedModule, filename: ORDER_TYPED }, ...typedCases.filter(each => !each.error).map(({ code, filename }) => ({ code, filename }))],
  invalid: typedCases.filter(each => each.error).map(({ code, filename, error }) => ({ code, filename, errors: [{ messageId: error }] })),
})

describe('the program queue-name is typed with', () => {
  it('has no errors of its own', () => {
    expect(ts.getPreEmitDiagnostics(typedProgram).map(each => ts.flattenDiagnosticMessageText(each.messageText, '\n'))).toEqual([])
  })
})

const ORDER_MODULE = '/repo/src/contexts/ws/modules/order/order.module.ts'
const moduleClass = body => `class Order_Module extends Module {\n${body}\n}`
tester.run('use-case', useCase, {
  valid: [
    { code: moduleClass("@UseCase() async place(input: unknown) {}\n@UseCase({ writesTo: ['stock'] }) async cancel(id: string) {}"), filename: ORDER_MODULE },
    { code: moduleClass("static initialize(base: unknown) { return new Order_Module() }\nprivate constructor() { super('order') }"), filename: ORDER_MODULE },
    { code: moduleClass("private load(id: string) {}\nprotected check() {}\n#secret() {}\nget name() { return 'order' }\nset name(value: string) {}"), filename: ORDER_MODULE },
    { code: moduleClass('readonly events = {}\nprivate readonly helper = () => 1'), filename: ORDER_MODULE },
    { code: moduleClass('place(input: string): void\nplace(input: number): void\n@UseCase() place(input: unknown) {}'), filename: ORDER_MODULE },
    { code: moduleClass('static { }\n[key: string]: unknown\n@UseCase() place() {}'), filename: ORDER_MODULE },
    { code: 'class Order_Module extends core.Module { @core.UseCase() async place(input: unknown) {} }', filename: ORDER_MODULE },
    { code: "import { Module, UseCase as UC } from 'newt/core'\n" + moduleClass('@UC() async place(input: unknown) {}'), filename: ORDER_MODULE },
    { code: moduleClass('constructor(private readonly run: () => void, readonly name: string) { super() }'), filename: ORDER_MODULE },
    // Not a module: another class, or another file.
    { code: 'class Order_Helper { place() {} }', filename: ORDER_MODULE },
    { code: moduleClass('place() {}'), filename: `${MODULE}/price-change.ts` },
  ],
  invalid: [
    { code: moduleClass('async place(input: unknown) {}'), filename: ORDER_MODULE, errors: [{ messageId: 'method', data: { name: 'place', module: 'Order_Module' } }] },
    { code: moduleClass('public async place(input: unknown) {}\n@UseCase() cancel() {}'), filename: ORDER_MODULE, errors: [{ messageId: 'method' }] },
    { code: moduleClass('@Traced() place() {}'), filename: ORDER_MODULE, errors: [{ messageId: 'method' }] },
    { code: moduleClass('place = async (input: unknown) => {}'), filename: ORDER_MODULE, errors: [{ messageId: 'field' }] },
    { code: 'export default class extends core.Module { place() {} }', filename: ORDER_MODULE, errors: [{ messageId: 'method', data: { name: 'place', module: 'this module' } }] },
    { code: "import { Module as Base } from 'newt/core'\nclass O extends Base { async place(input: unknown) {} }", filename: ORDER_MODULE, errors: [{ messageId: 'method', data: { name: 'place', module: 'O' } }] },
    { code: moduleClass('place = this.run.bind(this)'), filename: ORDER_MODULE, errors: [{ messageId: 'field', data: { name: 'place', module: 'Order_Module' } }] },
    { code: moduleClass('place = wrap(async () => {})'), filename: ORDER_MODULE, errors: [{ messageId: 'field' }] },
    { code: moduleClass('constructor(public readonly place: () => Promise<void>) { super() }'), filename: ORDER_MODULE, errors: [{ messageId: 'field', data: { name: 'place', module: 'Order_Module' } }] },
    { code: moduleClass('constructor(readonly place: () => Promise<void>) { super() }'), filename: ORDER_MODULE, errors: [{ messageId: 'field' }] },
    // A module every context shares, outside modules/, is one too.
    { code: moduleClass('place() {}'), filename: '/repo/src/shared/outbox/outbox.module.ts', errors: [{ messageId: 'method' }] },
  ],
})

const ORDER_ROUTES = '/repo/src/contexts/ws/modules/order/order.routes.ts'
tester.run('route-body', routeBody, {
  valid: [
    { code: 'async (request: Request) => orders.place(await request.json())', filename: ORDER_ROUTES },
    { code: 'async (request: Request) => { const body: unknown = await request.json(); return orders.place(body) }', filename: ORDER_ROUTES },
    { code: 'async (request: Request) => orders.place(await request.json() as unknown)', filename: ORDER_ROUTES },
    { code: 'async (request: Request) => orders.place(Schema.parse(await request.json()))', filename: ORDER_ROUTES },
    { code: 'async (response: Response) => (await response.json()) as OrderDTO', filename: `${MODULE}/price-change.test.ts` },
    { code: 'const x = value as OrderPlaceDTO', filename: ORDER_ROUTES },
    // What an upstream call answered is not the request's body.
    { code: 'async (request: Request) => { const upstream = await fetch(url); const token = await upstream.json() as ProviderToken; return tokens.open(token) }', filename: ORDER_ROUTES },
  ],
  invalid: [
    { code: 'async (request: Request) => orders.place(await request.json() as OrderPlaceDTO)', filename: ORDER_ROUTES, errors: [{ messageId: 'body', data: { type: 'OrderPlaceDTO' } }] },
    { code: 'async (request: Request) => orders.place((await request.json()) as OrderPlaceDTO)', filename: ORDER_ROUTES, errors: [{ messageId: 'body' }] },
    { code: 'async (req: Request) => orders.place(<OrderPlaceDTO>await req.json())', filename: ORDER_ROUTES, errors: [{ messageId: 'body' }] },
    { code: 'async (request: Request) => { const input: OrderPlaceDTO = await request.json(); return orders.place(input) }', filename: ORDER_ROUTES, errors: [{ messageId: 'body' }] },
    { code: 'async (request: Request) => { const { id }: { id: string } = await request.json(); return orders.get(id) }', filename: ORDER_ROUTES, errors: [{ messageId: 'body' }] },
    { code: 'async (request: Request) => orders.place(await (request.json() as Promise<OrderPlaceDTO>))', filename: ORDER_ROUTES, errors: [{ messageId: 'body' }] },
    // Routes outside modules/ (a shared module's) too.
    { code: 'async (request: Request) => sessions.open(await request.json() as SessionDTO)', filename: '/repo/src/shared/web-session/web-session.routes.ts', errors: [{ messageId: 'body' }] },
  ],
})
