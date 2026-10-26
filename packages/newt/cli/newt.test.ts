import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moduleNames } from './module-names'
import { run } from './newt'

// The command line, run as an application would: in a scratch application of its own,
// whose node_modules are the repository's (newt, newt-eslint, eslint, typescript), and
// zod where newt has it (a checkout of the tutorial before chapter 2 has no zod at its root).
const NODE_MODULES = join(import.meta.dir, '../../../node_modules')
const NEWT_ZOD = join(import.meta.dir, '../node_modules/zod')

/** A node_modules for an application in `folder`: the repository's, with zod surely in it. */
async function linkModules(folder: string): Promise<void> {
  const modules = join(folder, 'node_modules')
  await mkdir(modules, { recursive: true })
  const names = await readdir(NODE_MODULES)
  for (const name of names) await symlink(join(NODE_MODULES, name), join(modules, name))
  if (!names.includes('zod')) await symlink(NEWT_ZOD, join(modules, 'zod'), 'dir')
}
const CLI = join(import.meta.dir, 'newt.ts')

let app: string

/** Runs a command of Bun's in the scratch application: its exit code and what it said. */
async function bun(...args: string[]): Promise<{ code: number, output: string }> {
  const child = Bun.spawn([process.execPath, ...args], { cwd: app, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1' } })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, output: stdout + stderr }
}

beforeAll(async () => {
  app = await mkdtemp(join(tmpdir(), 'newt-cli-'))
  await linkModules(app)
  await Bun.write(join(app, 'package.json'), JSON.stringify({ name: 'scratch', private: true, type: 'module' }))
  await Bun.write(join(app, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2023', lib: ['ES2023'], module: 'ESNext', moduleResolution: 'bundler', types: ['bun'], noEmit: true, skipLibCheck: true, strict: true },
    include: ['**/*.ts'],
    exclude: ['**/node_modules'],
  }))
})

afterAll(() => rm(app, { recursive: true, force: true }))

describe('newt init', () => {
  test('writes AGENTS.md, a CLAUDE.md that imports it and newt\'s, and newt\'s lint', async () => {
    const { code, output } = await bun(CLI, 'init')

    expect(code).toBe(0)
    expect(output).toContain('wrote    AGENTS.md')
    expect(await Bun.file(join(app, 'AGENTS.md')).text()).toContain('read node_modules/newt/AGENTS.md')
    expect(await Bun.file(join(app, 'CLAUDE.md')).text()).toBe('@AGENTS.md\n@node_modules/newt/AGENTS.md\n')
    expect(await Bun.file(join(app, 'eslint.config.js')).text()).toContain("from 'newt-eslint'")
    expect(await Bun.file(join(app, 'node_modules/newt/AGENTS.md')).exists()).toBe(true)
  })

  test('never overwrites a file, and says which it left', async () => {
    await Bun.write(join(app, 'AGENTS.md'), '# Ours\n')

    const { lines, code } = await run(['init'], app)

    expect(code).toBe(0)
    expect(lines).toContain('skipped  AGENTS.md (it is there already: left as it was)')
    expect(lines).toContain('skipped  CLAUDE.md (it is there already: left as it was)')
    expect(await Bun.file(join(app, 'AGENTS.md')).text()).toBe('# Ours\n')
  })

  test('in an application inside a monorepo, points at the root\'s node_modules and keeps the root\'s lint', async () => {
    const root = join(app, 'monorepo')
    await Bun.write(join(root, 'eslint.config.js'), 'export default []\n')
    await linkModules(root)
    const web = join(root, 'apps/web')
    await mkdir(web, { recursive: true })

    const { lines, code } = await run(['init'], web)

    expect(code).toBe(0)
    expect(lines).toContain('skipped  eslint.config.js (../../eslint.config.js is there: add newt-eslint\'s preset to it, `newt()`)')
    expect(await Bun.file(join(web, 'eslint.config.js')).exists()).toBe(false)
    expect(await Bun.file(join(web, 'AGENTS.md')).text()).toContain('read ../../node_modules/newt/AGENTS.md')
    expect(await Bun.file(join(web, 'CLAUDE.md')).text()).toBe('@AGENTS.md\n@../../node_modules/newt/AGENTS.md\n')
  })
})

describe('newt add module', () => {
  test('names everything after the folder, as the lint does', () => {
    expect(moduleNames('price-change')).toEqual({ folder: 'price-change', module: 'priceChange', entity: 'PriceChange', table: 'price_change', words: 'price change', plural: 'priceChanges', path: 'price-changes' })
    expect(moduleNames('category')).toMatchObject({ plural: 'categories', path: 'categories' })
    expect(moduleNames('box')).toMatchObject({ plural: 'boxes' })
  })

  test('writes a module that compiles, passes newt\'s lint and its own test', async () => {
    const { code, output } = await bun(CLI, 'add', 'module', 'src/contexts/shop', 'price-change')
    expect([code, output]).toEqual([0, expect.stringContaining('wrote    src/contexts/shop/modules/price-change/price-change.module.ts')])

    const folder = join(app, 'src/contexts/shop/modules/price-change')
    for (const file of ['price-change.schema.ts', 'price-change.ts', 'price-change.repository.ts', 'price-change.module.ts', 'price-change.deps.ts', 'price-change.routes.ts', 'price-change.test.ts', 'events/price-change-created.ts', 'errors/price-change-not-found.ts']) {
      expect(await Bun.file(join(folder, file)).exists()).toBe(true)
    }
    expect(await Bun.file(join(folder, 'price-change.repository.ts')).text()).toContain("scope: 'none'")

    const checked = await bun('check', '--no-pretty')
    expect(checked.code).toBe(0)

    // The scratch application's own eslint.config.js, the one `newt init` wrote.
    const { ESLint } = await import('eslint')
    const results = await new ESLint({ cwd: app }).lintFiles(['src/**/*.ts'])
    expect(results.flatMap(result => result.messages.map(message => `${result.filePath}: ${message.ruleId} ${message.message}`))).toEqual([])
    expect(results.length).toBe(9)

    const tested = await bun('test', 'src')
    expect(tested.output).toContain('3 pass')
    expect(tested.code).toBe(0)
  }, 60_000)

  test('refuses a name that is no module folder\'s, and a module already there is left as it was', async () => {
    expect(await run(['add', 'module', 'src/contexts/shop', 'PriceChange'], app)).toMatchObject({ code: 1, lines: [expect.stringContaining('kebab case')] })

    const again = await run(['add', 'module', 'src/contexts/shop', 'price-change'], app)
    expect(again.lines.filter(line => line.startsWith('skipped'))).toHaveLength(9)
  })

  test('says how it is used when it is not', async () => {
    expect(await run(['add', 'thing'], app)).toMatchObject({ code: 1, lines: [expect.stringContaining('newt add module <context-folder> <name>')] })
  })
})
