import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ESLint } from 'eslint'
import { newt } from './index.js'

let root
let eslint

/** Lints one file of an application made with newt, and says which rules complain. */
async function complaints(path, code) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), code)
  const [result] = await eslint.lintFiles([join(root, path)])
  return result.messages.map(each => each.ruleId ?? each.message)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'newt-eslint-'))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'bundler', paths: { '@/*': ['./src/*'] } }, include: ['**/*.ts'] }))
  eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: newt({ contexts: { folder: 'src/contexts', uses: { auth: [], ws: ['auth'], cs: ['auth'] } } }) })
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('the preset of newt', () => {
  test('keeps contexts a tree', async () => {
    expect(await complaints('src/contexts/ws/ws.context.ts', "import { x } from '../cs/cs.context'\nexport const y = x\n")).toEqual(['newt/context-boundaries'])
    expect(await complaints('src/contexts/ws/ws.context.ts', "import { x } from '@/contexts/cs/cs.context'\nexport const y = x\n")).toEqual(['newt/context-boundaries'])
    expect(await complaints('src/contexts/ws/ws.context.ts', "import { x } from '../auth/auth.context'\nexport const y = x\n")).toEqual([])
  })

  test('refuses contexts that are no tree', () => {
    expect(() => newt({ contexts: { folder: 'src/contexts', uses: { auth: ['shop'], shop: ['auth'] } } })).toThrow('auth → shop → auth')
    expect(() => newt({ contexts: { folder: 'src/contexts', uses: { shop: ['auth'] } } })).toThrow("uses 'auth', which is not in `uses`")
  })

  test("reads an alias of the tsconfig's paths as the file it names", async () => {
    expect(await complaints('src/contexts/ws/modules/order/order.module.ts', "import { x } from '@/contexts/ws/modules/brand/brand.repository'\nexport const y = x\n")).toEqual(['newt/module-boundaries'])
    expect(await complaints('src/contexts/ws/modules/order/order.deps.ts', "import { x } from '@/contexts/ws/modules/brand/brand.module'\nexport const y = x\n")).toEqual([])
  })

  test('keeps a module writing through save', async () => {
    expect(await complaints('src/contexts/ws/modules/brand/brand.repository.ts', 'export const go = (store: { transaction(fn: () => void): void }) => store.transaction(() => {})\n')).toEqual(['no-restricted-syntax'])
    expect(await complaints('src/contexts/ws/modules/brand/brand.repository.ts', "export const go = (store: { transaction(fn: () => void): void }) => store['transaction'](() => {})\n")).toEqual(['no-restricted-syntax'])
    expect(await complaints('src/contexts/ws/modules/brand/brand.repository.ts', 'export const go = (store: { transaction(fn: () => void): void }) => { const { transaction } = store; transaction(() => {}) }\n')).toEqual(['no-restricted-syntax'])
  })

  test("judges a handler's callback by the types TypeScript gives, not by names", async () => {
    const workers = (calls) => [
      'class Order_Module { events = { placed: { subscribe: (fn: (o: { id: string }) => unknown, s: object) => fn } }; fulfil(id: string) { return id } }',
      'type Order_Deps = { orders: { fulfil(id: string): void } }',
      `export function register(orders: Order_Module, deps: Order_Deps, untyped: any) {`,
      `  orders.events.placed.subscribe(o => ${calls}, { strategy: 'handler', queue: 'order.fulfil.on.order.placed' })`,
      '}',
    ].join('\n')

    expect(await complaints('src/contexts/ws/modules/order/order.workers.ts', workers('orders.fulfil(o.id)'))).toEqual([])
    // Named after the module, but not of its type: not the module.
    expect(await complaints('src/contexts/ws/modules/order/order.workers.ts', workers('deps.orders.fulfil(o.id)'))).toEqual(['newt/queue-name'])
    // Of no type TypeScript knows: not judged.
    expect(await complaints('src/contexts/ws/modules/order/order.workers.ts', workers('untyped.fulfil(o.id)'))).toEqual([])
  })

  test("keeps a module's schema to newt/contract, which a frontend may load", async () => {
    const schema = 'src/contexts/ws/modules/order/order.schema.ts'
    expect(await complaints(schema, "import { defineFilter } from 'newt/contract'\nimport { z } from 'zod'\nexport const x = [defineFilter, z]\n")).toEqual([])
    expect(await complaints(schema, "import { ValidationError } from 'newt/core'\nexport const x = ValidationError\n")).toEqual(['newt/schema-imports'])
    expect(await complaints(schema, "import type { Page } from 'newt/core'\nexport type X = Page<string>\n")).toEqual(['newt/schema-imports'])
    expect(await complaints(schema, "export { HttpRouter } from 'newt/http'\n")).toEqual(['newt/schema-imports'])
    // The rest of a module is the server's: it may.
    expect(await complaints('src/contexts/ws/modules/order/order.module.ts', "import { Module } from 'newt/core'\nexport const x = Module\n")).toEqual([])
  })

  test('keeps every public method of a module a use case, wherever the module is', async () => {
    const module = body => `import { Module, UseCase } from 'newt/core'\nexport class Order_Module extends Module {\n${body}\n}\n`
    expect(await complaints('src/contexts/ws/modules/order/order.module.ts', module('@UseCase() async place() {}\nprivate load() {}'))).toEqual([])
    expect(await complaints('src/contexts/ws/modules/order/order.module.ts', module('async place() {}'))).toEqual(['newt/use-case'])
    expect(await complaints('src/shared/outbox/outbox.module.ts', module('async dead() {}'))).toEqual(['newt/use-case'])
  })

  test("passes a route's body to a use case as it came", async () => {
    const routes = call => `type OrderPlaceDTO = { item: string }\ndeclare const orders: { place(input: unknown): Promise<void> }\nexport const route = async (request: Request) => orders.place(${call})\n`
    expect(await complaints('src/contexts/ws/modules/order/order.routes.ts', routes('await request.json()'))).toEqual([])
    expect(await complaints('src/contexts/ws/modules/order/order.routes.ts', routes('await request.json() as OrderPlaceDTO'))).toEqual(['newt/route-body'])
  })

  test('refuses a promise left unawaited', async () => {
    expect(await complaints('src/contexts/ws/modules/brand/brand.module.ts', 'async function save() {}\nexport function create() { save() }\n')).toEqual(['@typescript-eslint/no-floating-promises'])
  })

  test('reads where a module is from the project, not from the folders above it', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'newt-eslint-'))
    const project = join(outer, 'modules', 'proj')
    await mkdir(join(project, 'shop/modules/order'), { recursive: true })
    await writeFile(join(project, 'tsconfig.json'), JSON.stringify({ include: ['**/*.ts'] }))
    await writeFile(join(project, 'shop/modules/order/order.module.ts'), "import { Order_Repository } from '../product/product.repository'\nexport const x = Order_Repository\n")
    try {
      const linter = new ESLint({ cwd: project, overrideConfigFile: true, overrideConfig: newt() })
      const [result] = await linter.lintFiles([join(project, 'shop/modules/order/order.module.ts')])
      expect(result.messages.map(each => each.ruleId)).toEqual(['newt/module-boundaries'])
    } finally {
      await rm(outer, { recursive: true, force: true })
    }
  })

  test('lints only the files it is given, when given some', async () => {
    const linter = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: newt({ files: ['app/**/*.ts'], contexts: { folder: 'app/contexts', uses: { auth: [], ws: ['auth'] } } }) })
    const lint = async (path, code) => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), code)
      const [result] = await linter.lintFiles([join(root, path)])
      return result?.messages.map(each => each.ruleId ?? each.message)
    }

    expect(await lint('app/contexts/ws/modules/order/helpers.ts', 'export const x = 1\n')).toEqual(['newt/module-anatomy'])
    expect(await lint('app/contexts/auth/auth.context.ts', "import { x } from '../ws/ws.context'\nexport const y = x\n")).toEqual(['newt/context-boundaries'])
    expect(await lint('other/modules/order/helpers.ts', 'export const x = 1\n')).toEqual([expect.stringContaining('no matching configuration')])
  })

  test('finds the modules of an application without contexts the same way', async () => {
    expect(await complaints('shop/modules/order/helpers.ts', 'export const x = 1\n')).toEqual(['newt/module-anatomy'])
  })
})
