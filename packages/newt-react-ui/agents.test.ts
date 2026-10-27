import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import manifest from './package.json'

// What agents read is what there is: every component of the library is in the catalog.
describe('AGENTS.md', () => {
  test('names every component the library exports', async () => {
    const catalog = await Bun.file(join(import.meta.dir, 'AGENTS.md')).text()
    const folders = (await readdir(join(import.meta.dir, 'components'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
    const missing: string[] = []
    for (const folder of folders) {
      const exported = Object.keys(await import(`./components/${folder}/index.ts`)).filter(name => /^[A-Z]/.test(name) && !name.endsWith('Context'))
      for (const name of exported) if (!catalog.includes(`\`${name}\``)) missing.push(`${folder}: ${name}`)
    }
    expect(missing).toEqual([])
  })

  test('is what newt init installs, with the skill', () => {
    expect(manifest.newt).toEqual({ agents: 'AGENTS.md', skills: ['skills/newt-react-ui'] })
  })
})
