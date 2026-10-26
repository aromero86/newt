import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeStoreContract, type ThingRow } from '../port-store/contract'
import type { FileMigration } from './file-migration'
import { FileStore } from './file-store'

const folders: string[] = []

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function folder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'framework-files-'))
  folders.push(path)
  return path
}

describeStoreContract('FileStore', {
  open: async () => FileStore.open({ folder: await folder() }),
})

describe('FileStore', () => {
  test('keeps each record in a file of its own, as JSON', async () => {
    const path = await folder()
    const store = await FileStore.open({ folder: path })
    await store.table<{ id: string, title: string, version: number }>('note').insert({ id: 'n1', title: 'hi' })

    expect(await readdir(join(path, 'note'))).toEqual(['n1.json'])
    expect(await Bun.file(join(path, 'note/n1.json')).json()).toEqual({ id: 'n1', title: 'hi', version: 1 })
  })

  test('finishes, on the next lock, a commit a crash left halfway', async () => {
    const path = await folder()
    // What a process left when it died after the journal, before writing the records.
    await Bun.write(join(path, '_journal.json'), JSON.stringify([
      { collection: 'note', id: 'n1', record: { id: 'n1', title: 'kept', version: 1 } },
      { collection: 'note', id: 'n2', record: null },
    ]))
    await Bun.write(join(path, 'note/n2.json'), JSON.stringify({ id: 'n2', version: 1 }))

    const store = await FileStore.open({ folder: path })

    expect(await store.collection('note').all()).toEqual([{ id: 'n1', title: 'kept', version: 1 }])
    expect(await Bun.file(join(path, '_journal.json')).exists()).toBe(false)
  })

  test('shares its folder with another process, one at a time', async () => {
    const path = await folder()
    const store = await FileStore.open({ folder: path })
    const script = `
      const { FileStore } = await import(${JSON.stringify(join(import.meta.dir, 'file-store.ts'))})
      const store = await FileStore.connect({ folder: ${JSON.stringify(path)} })
      await Bun.write(${JSON.stringify(join(path, 'ready'))}, '')
      for (let i = 0; i < 20; i++) {
        await store.transaction(async () => {
          const counter = store.collection('counter')
          const now = (await counter.get('c'))?.value ?? 0
          await Bun.sleep(1)
          await counter.put({ id: 'c', value: now + 1 })
        })
      }`
    const other = Bun.spawn(['bun', '-e', script], { stderr: 'pipe' })
    // Both start together, so their transactions overlap unless the lock keeps them apart.
    while (!(await Bun.file(join(path, 'ready')).exists())) await Bun.sleep(1)
    for (let i = 0; i < 20; i++) {
      await store.transaction(async () => {
        const counter = store.collection('counter')
        const now = ((await counter.get('c'))?.value as number | undefined) ?? 0
        await Bun.sleep(1)
        await counter.put({ id: 'c', value: now + 1 })
      })
    }
    expect(await other.exited).toBe(0)

    expect((await store.collection('counter').get('c'))?.value).toBe(40)
  })

  test('takes over a lock left by a process that died', async () => {
    const path = await folder()
    await Bun.write(join(path, '_lock'), '999999999')

    const store = await FileStore.open({ folder: path })
    await store.table('note').insert({ id: 'n1' })

    expect(await store.table('note').count()).toBe(1)
  })

  test('makes its folder when there is none', async () => {
    const path = join(await folder(), 'not/there/yet')
    const store = await FileStore.open({ folder: path })
    await store.table('note').insert({ id: 'n1' })

    expect(await readdir(join(path, 'note'))).toEqual(['n1.json'])
  })

  test('takes over a lock no one touches any more, even naming this very process: an earlier life with the same id', async () => {
    const path = await folder()
    await Bun.write(join(path, '_lock'), `${process.pid}:earlier`)
    const old = new Date(Date.now() - 6_000)
    await utimes(join(path, '_lock'), old, old)

    const store = await FileStore.open({ folder: path })
    await store.table('note').insert({ id: 'n1' })

    expect(await store.table('note').count()).toBe(1)
    expect(await Bun.file(join(path, '_lock')).exists()).toBe(false)
  })

  test('two stores on one folder in one process take turns', async () => {
    const path = await folder()
    const [one, two] = await Promise.all([FileStore.open({ folder: path }), FileStore.open({ folder: path })])
    const bump = (store: FileStore) => store.transaction(async () => {
      const counter = store.collection('counter')
      const now = ((await counter.get('c'))?.value as number | undefined) ?? 0
      await counter.put({ id: 'c', value: now + 1 })
    })

    await Promise.all(Array.from({ length: 10 }, (_, i) => bump(i % 2 ? one : two)))

    expect((await one.collection('counter').get('c'))?.value).toBe(10)
  })

  test('refuses ids that would leave its folder', async () => {
    const store = await FileStore.open({ folder: await folder() })

    expect(() => store.collection('note').put({ id: '../escape' })).toThrow('id')
    expect(() => store.table('_jobs')).toThrow("store's own")
  })
})

describe('FileStore migrations', () => {
  const archived: FileMigration = {
    version: 1,
    name: 'note-archived',
    up: async store => {
      const notes = store.collection('note')
      for (const note of await notes.all()) await notes.put({ ...note, archived: false })
    },
    down: async store => {
      const notes = store.collection('note')
      for (const { archived: _, ...note } of await notes.all()) await notes.put(note)
    },
  }

  test('transform the records, and are remembered', async () => {
    const path = await folder()
    const before = await FileStore.open({ folder: path })
    await before.collection('note').put({ id: 'n1', version: 1 })

    const store = await FileStore.open({ folder: path, migrations: [archived] })

    expect(await store.collection('note').all()).toEqual([{ id: 'n1', version: 1, archived: false }])
    expect(await store.migrations.status()).toEqual({ applied: ['00001_note-archived'], pending: [], changed: [] })
    expect(await store.migrations.up()).toEqual([])
  })

  test('apply all or none', async () => {
    const path = await folder()
    const broken: FileMigration = { version: 2, name: 'broken', up: async () => { throw new Error('boom') }, down: async () => {} }

    await expect(FileStore.open({ folder: path, migrations: [archived, broken] })).rejects.toThrow('boom')

    expect(await (await FileStore.connect({ folder: path, migrations: [archived, broken] })).migrations.status()).toEqual({ applied: [], pending: ['00001_note-archived', '00002_broken'], changed: [] })
  })

  test('revert the last one applied', async () => {
    const path = await folder()
    const store = await FileStore.open({ folder: path, migrations: [archived] })
    await store.collection('note').put({ id: 'n1', version: 1, archived: true })

    expect(await store.migrations.down()).toBe('00001_note-archived')
    expect(await store.collection('note').all()).toEqual([{ id: 'n1', version: 1 }])
  })
})
