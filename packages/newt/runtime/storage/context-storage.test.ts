import { describe, expect, test } from 'bun:test'
import { MemoryPublicStorage, MemoryStorage } from '../../port-storage'
import { SqliteStore } from '../../adapter-sqlite'
import { Base } from '../base'

const open = async (storage?: ConstructorParameters<typeof Base>[0]['storage']) =>
  new Base({ name: 'boards', store: await SqliteStore.open({ path: ':memory:' }), storage })

describe('base.storage', () => {
  test('a module\'s files are under its context and its own name', async () => {
    const memory = new MemoryStorage()
    const base = await open({ private: memory })

    await base.storage.private.in('attachment').put('a', 'hello', { contentType: 'text/plain' })

    expect(await memory.stat('boards/attachment/a')).toEqual({ size: 5, contentType: 'text/plain' })
    await base.close()
  })

  test('two contexts on one place never meet', async () => {
    const memory = new MemoryStorage()
    const boards = await open({ private: memory })
    const auth = new Base({ name: 'auth', store: await SqliteStore.open({ path: ':memory:' }), storage: { private: memory } })

    await boards.storage.private.in('x').put('a', 'hello', { contentType: 'text/plain' })

    expect(await auth.storage.private.in('x').stat('a')).toBeNull()
    await boards.close()
    await auth.close()
  })

  test('public files have an address', async () => {
    const base = await open({ public: new MemoryPublicStorage() })

    expect(base.storage.public.in('avatar').url('a')).toBe('memory://public/boards/avatar/a')
    await base.close()
  })

  test('a context given none opens, and says so only when a module asks', async () => {
    const base = await open()

    expect(() => base.storage.private).toThrow("The context 'boards' was given no private storage")
    expect(() => base.storage.public).toThrow("The context 'boards' was given no public storage")
    await base.close()
  })

  test('a kind given does not make the other one up', async () => {
    const base = await open({ private: new MemoryStorage() })

    expect(() => base.storage.public).toThrow('no public storage')
    await base.close()
  })
})
