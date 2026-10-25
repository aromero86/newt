import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const originalError = console.error

describe('a transaction of a files store', () => {
  test('reads back what it wrote, and not what it removed', async () => {
    const store = await FileStore.open({ folder: await folder() })
    const notes = store.collection('note')
    await notes.put({ id: 'gone', title: 'old' })

    const seen = await store.transaction(async () => {
      await notes.put({ id: 'n1', title: 'new' })
      await notes.remove('gone')
      return { one: await notes.get('n1'), gone: await notes.get('gone'), all: (await notes.all()).map(note => note.id) }
    })

    expect(seen).toEqual({ one: { id: 'n1', title: 'new' }, gone: undefined, all: ['n1'] })
  })

  test('a row inserted in it can be changed in it, at its version', async () => {
    const store = await FileStore.open({ folder: await folder() })
    const table = store.table<{ id: string, version: number, title: string }>('note')

    await store.transaction(async () => {
      await table.insert({ id: 'n1', title: 'first' })
      await table.update('n1', 1, { title: 'second' })
    })

    expect(await table.find()).toEqual([{ id: 'n1', version: 2, title: 'second' }])
  })

  test('keeps copies: changing an object after writing it, or one it read, changes nothing', async () => {
    const store = await FileStore.open({ folder: await folder() })
    const notes = store.collection('note')

    const seen = await store.transaction(async () => {
      const written = { id: 'n1', title: 'kept' }
      await notes.put(written)
      written.title = 'changed after'
      const read = (await notes.get('n1'))!
      read.title = 'changed too'
      const [listed] = await notes.all()
      listed!.title = 'and again'
      return (await notes.get('n1'))!.title
    })

    expect(seen).toBe('kept')
    expect((await notes.get('n1'))!.title).toBe('kept')
  })
})

describe('a commit of a files store', () => {
  test('once in the journal, it is committed even when its records cannot be written yet', async () => {
    const path = await folder()
    const store = await FileStore.open({ folder: path })
    // A folder where the record's file goes keeps it from being written.
    await mkdir(join(path, 'note/n1.json'), { recursive: true })
    console.error = () => {}

    try {
      await store.collection('note').put({ id: 'n1', title: 'kept' })
    } finally {
      console.error = originalError
    }

    expect(JSON.parse(await Bun.file(join(path, '_journal.json')).text())).toEqual([{ collection: 'note', id: 'n1', record: { id: 'n1', title: 'kept' } }])
    await rm(join(path, 'note/n1.json'), { recursive: true })
    expect(await store.collection('note').get('n1')).toEqual({ id: 'n1', title: 'kept' })
    expect(await Bun.file(join(path, '_journal.json')).exists()).toBe(false)
  })

  test('a journal it cannot read leaves the lock free', async () => {
    const path = await folder()
    await Bun.write(join(path, '_journal.json'), '[{"cut short')
    const store = await FileStore.connect({ folder: path })

    await expect(store.collection('note').all()).rejects.toThrow()

    expect(await Bun.file(join(path, '_lock')).exists()).toBe(false)
  })

  test('leaves no temporary file behind', async () => {
    const path = await folder()
    const store = await FileStore.open({ folder: path })
    await store.collection('note').put({ id: 'n1' })
    await store.collection('note').put({ id: 'n1', again: true })

    expect(await readdir(join(path, 'note'))).toEqual(['n1.json'])
    expect((await readdir(path)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('a files store', () => {
  test('a read outside a transaction waits for the lock too', async () => {
    const path = await folder()
    const store = await FileStore.open({ folder: path })
    await Bun.write(join(path, '_lock'), `${process.ppid}:other`)

    const reading = store.collection('note').all()
    expect(await Promise.race([reading.then(() => 'read'), Bun.sleep(50).then(() => 'waiting')])).toBe('waiting')
    await rm(join(path, '_lock'))

    expect(await reading).toEqual([])
  })

  test('names collections with letters, numbers, - and _ only', async () => {
    const store = await FileStore.open({ folder: await folder() })

    expect(() => store.collection('../escape')).toThrow('collection')
    expect(() => store.collection('a b')).toThrow('collection')
  })

  test('closing waits for the transactions in progress', async () => {
    const store = await FileStore.open({ folder: await folder() })
    const log: string[] = []

    const running = store.transaction(async () => {
      await Bun.sleep(10)
      log.push('transaction ended')
    })
    await Bun.sleep(1)
    await store.close()
    log.push('closed')
    await running

    expect(log).toEqual(['transaction ended', 'closed'])
  })

  test('a collection is its .json files: anything else in its folder is not a record', async () => {
    const path = await folder()
    const store = await FileStore.open({ folder: path })
    await store.collection('note').put({ id: 'n1' })
    await Bun.write(join(path, 'note/n2.json.123.tmp'), '{"id":"n2"}')
    await Bun.write(join(path, 'note/README'), 'notes')

    expect((await store.collection('note').all()).map(note => note.id)).toEqual(['n1'])
  })
})

describe('a table of a files store', () => {
  type Row = { id: string, version: number, name: string | null, rank?: number, a?: number, b?: number, deletedAt?: string | null }

  const open = async (unique: (keyof Row & string)[][] = []) => (await FileStore.open({ folder: await folder() })).table<Row>('thing', { unique })

  test('orders by each field in turn, and takes a limit of 0', async () => {
    const table = await open()
    await table.insert({ id: 't1', name: 'b', rank: 1 })
    await table.insert({ id: 't2', name: 'a', rank: 1 })
    await table.insert({ id: 't3', name: 'c', rank: 0 })

    expect((await table.find({}, { orderBy: [{ field: 'rank' }, { field: 'name', direction: 'desc' }] })).map(row => row.id)).toEqual(['t3', 't1', 't2'])
    expect(await table.find({}, { limit: 0 })).toEqual([])
  })

  test('a unique value: a row never clashes with itself, nor with a deleted one, and null shares nothing', async () => {
    const table = await open([['name']])
    await table.insert({ id: 't1', name: 'taken' })
    await table.update('t1', 1, { name: 'taken', rank: 2 })
    await table.insert({ id: 't2', name: 'taken', deletedAt: 'gone' })
    await table.insert({ id: 't3', name: null })
    await table.insert({ id: 't4', name: null })

    expect(await table.count()).toBe(4)
  })

  test('a unique set of fields clashes only when every field does', async () => {
    const table = await open([['a', 'b']])
    await table.insert({ id: 't1', name: null, a: 1, b: 1 })
    await table.insert({ id: 't2', name: null, a: 1, b: 2 })

    await expect(table.insert({ id: 't3', name: null, a: 1, b: 1 })).rejects.toThrow()
  })

  test('a patch leaves the id and the version alone, and a field left undefined stays as it was', async () => {
    const table = await open()
    await table.insert({ id: 't1', name: 'kept', rank: 1 })

    await table.patch('t1', { id: 'other', version: 9, rank: 2 } as never)
    await table.update('t1', 1, { name: undefined, rank: 3 })

    expect(await table.find()).toEqual([{ id: 't1', version: 2, name: 'kept', rank: 3 }])
  })
})

describe('the migrations of a files store', () => {
  const migration = (version: number, name: string, log: string[]): FileMigration => ({
    version,
    name,
    up: async () => void log.push(`up ${name}`),
    down: async () => void log.push(`down ${name}`),
  })

  test('refuses two of one version', async () => {
    const log: string[] = []
    await expect(FileStore.open({ folder: await folder(), migrations: [migration(1, 'a', log), migration(1, 'b', log)] })).rejects.toThrow('share a version')
  })

  test('applies them in order of version, whatever order they are given in, and remembers each by it', async () => {
    const path = await folder()
    const log: string[] = []

    const store = await FileStore.open({ folder: path, migrations: [migration(2, 'second', log), migration(1, 'first', log)] })

    expect(log).toEqual(['up first', 'up second'])
    expect(await store.migrations.status()).toEqual({ applied: ['00001_first', '00002_second'], pending: [] })
    expect((await readdir(join(path, '_migrations'))).sort()).toEqual(['00001.json', '00002.json'])
  })

  test('refuses a store whose last migration it does not know', async () => {
    const path = await folder()
    await FileStore.open({ folder: path, migrations: [migration(1, 'first', [])] })

    await expect(FileStore.open({ folder: path, migrations: [migration(1, 'renamed', [])] })).rejects.toThrow('not among')
  })

  test('down reverts the last applied, forgets it, and refuses one it does not know', async () => {
    const path = await folder()
    const log: string[] = []
    const store = await FileStore.open({ folder: path, migrations: [migration(1, 'first', log), migration(2, 'second', log)] })

    expect(await store.migrations.down()).toBe('00002_second')
    expect(log.at(-1)).toBe('down second')
    expect(await store.migrations.status()).toEqual({ applied: ['00001_first'], pending: ['00002_second'] })

    const stranger = await FileStore.connect({ folder: path, migrations: [migration(2, 'second', log)] })
    await expect(stranger.migrations.down()).rejects.toThrow('not among')
  })
})
