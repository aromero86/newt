import { describe, expect, test } from 'bun:test'

describe('@newt-kit/newt/contract', () => {
  test('loads in a browser: nothing in it keeps a scope', async () => {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/index.ts`], target: 'browser', external: ['zod'] })
    expect(built.success).toBe(true)
    const code = await built.outputs[0]!.text()
    expect(code).not.toContain('AsyncLocalStorage')
    expect(code).toContain('defineFilter')
  })
})
