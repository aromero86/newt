import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import manifest from './package.json'

// Applications in this repository (cooper) reach newt through the root tsconfig's alias, `newt/*` to
// `packages/newt/*/index.ts`, not through this package's `exports`. They agree only while
// every entry point is an `index.ts` and every `index.ts` is an entry point.
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
