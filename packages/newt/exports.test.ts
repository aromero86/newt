import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import manifest from './package.json'

// Every entry point is an `index.ts`, and every `index.ts` an entry point: a folder is a
// subpath of the package or it is private to it. Applications (cooper) reach newt through
// these `exports`, as a dependency of their own.
describe('exports', () => {
  test('are exactly the folders with an index.ts, each to its own', async () => {
    const indexes = await Array.fromAsync(new Glob('**/index.ts').scan({ cwd: import.meta.dir }))
    const folders = indexes.filter(path => !path.includes('node_modules')).map(path => path.replace(/\/index\.ts$/, ''))

    expect(Object.keys(manifest.exports).sort()).toEqual(folders.map(folder => `./${folder}`).sort())
    for (const [entry, target] of Object.entries(manifest.exports)) expect(target).toBe(`${entry}/index.ts`)
  })

  test('each one loads by its name', async () => {
    for (const entry of Object.keys(manifest.exports)) expect(await import(`newt/${entry.slice(2)}`)).toBeDefined()
  })
})
