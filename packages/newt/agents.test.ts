import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { join } from 'node:path'

// AGENTS.md is the rules a coding agent reads before writing an application with newt,
// shipped with the package. It names every rule the lint and the framework enforce, so a
// new one, or one renamed, fails here until AGENTS.md says it.
const dir = import.meta.dir
const agents = await Bun.file(join(dir, 'AGENTS.md')).text()

/** The framework's own code, tests left out. */
async function sources(): Promise<string[]> {
  const paths = await Array.fromAsync(new Glob('**/*.ts').scan({ cwd: dir }))
  const own = paths.filter(path => !path.includes('node_modules') && !path.endsWith('.test.ts') && !path.includes('/contract/'))
  return Promise.all(own.map(path => Bun.file(join(dir, path)).text()))
}

describe('AGENTS.md', () => {
  test('ships with the package', async () => {
    const manifest = await Bun.file(join(dir, 'package.json')).json() as { files?: string[] }
    // With no `files`, everything is published; with some, AGENTS.md must be one.
    if (manifest.files) expect(manifest.files).toContain('AGENTS.md')
    expect(agents.length).toBeGreaterThan(0)
  })

  test('names every rule of newt-kit-eslint', async () => {
    const { plugin } = await import('newt-kit-eslint' as string) as { plugin: { rules: Record<string, unknown> } }
    const rules = Object.keys(plugin.rules)
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) expect(agents).toContain(`newt/${rule}`)
    for (const rule of ['no-restricted-syntax', '@typescript-eslint/no-floating-promises']) expect(agents).toContain(rule)
  })

  test('tells what to do about every rule the framework enforces as it runs', async () => {
    const code = (await sources()).join('\n')
    const prefixes = [...new Set([...code.matchAll(/`\[([a-z]+ rule)\]/g)].map(match => `[${match[1]}]`))]
    expect(prefixes).toEqual(expect.arrayContaining(['[write rule]', '[guard rule]']))
    for (const prefix of prefixes) expect(agents).toContain(prefix)

    // Each phrase is still the framework's, and AGENTS.md still explains it.
    for (const phrase of ['one module per transaction', 'keeps fields it does not name', 'not to the current one', 'idempotency_key_in_use', 'idempotency_key_reused']) {
      expect(code).toContain(phrase)
      expect(agents).toContain(phrase)
    }
  })

  test("names every error an entity's misuse or a save throws", async () => {
    const files = await Array.fromAsync(new Glob('core/entity/errors/*.ts').scan({ cwd: dir }))
    const classes = (await Promise.all(files.map(file => Bun.file(join(dir, file)).text())))
      .flatMap(text => [...text.matchAll(/export class (\w+)/g)].map(match => match[1]!))
    expect(classes.length).toBeGreaterThan(0)
    for (const name of [...classes, 'ConcurrencyConflict', 'DuplicateValue', 'NoActor', 'ReferenceNotFound']) expect(agents).toContain(name)
  })
})
