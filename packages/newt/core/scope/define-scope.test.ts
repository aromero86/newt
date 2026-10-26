import { describe, expect, test } from 'bun:test'
import { defineScope } from './define-scope'

describe('defineScope', () => {
  test('carries a value down to everything run in it, across awaits', async () => {
    const workspace = defineScope<{ id: string }>('workspace')
    const read = async () => {
      await Bun.sleep(1)
      return workspace.current().id
    }

    expect(await workspace.run({ id: 'w1' }, read)).toBe('w1')
    expect(workspace.run({ id: 'w2' }, () => workspace.find())).toEqual({ id: 'w2' })
  })

  test('throws outside it, with the error it was given', () => {
    const plain = defineScope<string>('workspace')
    const custom = defineScope<string>('tenant', { missing: () => new Error('no tenant') })

    expect(() => plain.current()).toThrow('workspace scope')
    expect(() => custom.current()).toThrow('no tenant')
    expect(plain.find()).toBeUndefined()
  })

  test('keeps scopes apart, each with its own value', () => {
    const one = defineScope<number>('one')
    const two = defineScope<number>('two')

    expect(one.run(1, () => two.run(2, () => [one.current(), two.current()]))).toEqual([1, 2])
  })
})
