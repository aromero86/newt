import { describe, expect, test } from 'bun:test'
import { resolved } from './paths.js'

/** The context of a rule linting `filename`, in a program built with these compiler options. */
const linting = (options, filename = '/repo/src/a.ts') => ({ filename, sourceCode: { parserServices: { program: { getCompilerOptions: () => options } } } })

describe('the file an import points at', () => {
  test("reads an alias from the tsconfig's baseUrl when it has one, as TypeScript does", () => {
    const context = linting({ baseUrl: '/repo/src', pathsBasePath: '/repo', paths: { '@x/*': ['x/*'] } })
    expect(resolved(context, '@x/order.module.js')).toBe('/repo/src/x/order.module')
    expect(resolved(linting({ pathsBasePath: '/repo', paths: { '@x/*': ['x/*'] } }), '@x/order')).toBe('/repo/x/order')
  })

  test('skips an alias that names no file', () => {
    const context = linting({ pathsBasePath: '/repo', paths: { '@empty/*': [], '@none': [], '@/*': ['src/*'] } })
    expect(resolved(context, '@empty/foo')).toBeNull()
    expect(resolved(context, '@none')).toBeNull()
    expect(resolved(context, '@/a')).toBe('/repo/src/a')
  })
})
