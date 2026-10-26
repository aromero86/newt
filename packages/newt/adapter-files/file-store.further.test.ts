import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConcurrencyConflict } from '../core'
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
    // Until it is written, nothing else runs: what it read would miss a committed transaction.
    await expect(store.collection('other').all()).rejects.toThrow('cannot finish the commit')
    await rm(join(path, 'note/n1.json'), { recursive: true })
    expect(await store.collection('note').get('n1')).toEqual({ id: 'n1', title: 'kept' })
    expect(await Bun.file(join(path, '_journal.json')).exists()).toBe(false)
  })

  test('a journal with records no file can be named for puts them aside, and writes the rest', async () => {
    const path = await folder()
    // Left by a version that took any length of id.
    const long = { collection: 'note', id: 'a'.repeat(250), record: { id: 'a'.repeat(250) } }
    await Bun.write(join(path, '_journal.json'), JSON.stringify([long, { collection: 'note', id: 'n1', record: { id: 'n1' } }]))
    console.error = () => {}

    try {
      expect(await (await FileStore.open({ folder: path })).collection('note').all()).toEqual([{ id: 'n1' }])
    } finally {
      console.error = originalError
    }

    const aside = (await readdir(path)).filter(name => name.endsWith('.unwritable.json'))
    expect(aside).toHaveLength(1)
    expect(await Bun.file(join(path, aside[0]!)).json()).toEqual([long])
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

  test('an id has up to 100 characters: a longer one is refused before anything is written', async () => {
    const path = await folder()
    const notes = (await FileStore.open({ folder: path })).table<{ id: string, version: number }>('note')

    await notes.insert({ id: 'a'.repeat(100) })
    await expect(notes.insert({ id: 'a'.repeat(101) })).rejects.toThrow('id')

    expect(await notes.count()).toBe(1)
    expect(await Bun.file(join(path, '_journal.json')).exists()).toBe(false)
  })

  test('a read by an id no record can have finds nothing, and never leaves the folder', async () => {
    const path = await folder()
    await Bun.write(join(path, 'secret.json'), JSON.stringify({ id: 'secret', version: 1 }))
    const store = await FileStore.open({ folder: join(path, 'store') })
    const notes = store.table<{ id: string, version: number, title?: string }>('note')

    expect(await store.collection('note').get('../../secret')).toBeUndefined()
    await expect(notes.update('../../secret', 1, { title: 'x' })).rejects.toThrow(ConcurrencyConflict)
    await expect(notes.delete('../../secret', 1)).rejects.toThrow(ConcurrencyConflict)
    await notes.patch('../../secret', { title: 'x' })

    expect(await Bun.file(join(path, 'secret.json')).json()).toEqual({ id: 'secret', version: 1 })
  })

  test('one folder opened through two paths in one process takes turns as one', async () => {
    const path = await folder()
    const alias = `${path}-alias`
    await symlink(path, alias)
    folders.push(alias)
    const [one, two] = await Promise.all([FileStore.open({ folder: path }), FileStore.open({ folder: alias })])
    const bump = (store: FileStore) => store.transaction(async () => {
      const counter = store.collection('counter')
      const now = ((await counter.get('c'))?.value as number | undefined) ?? 0
      await Bun.sleep(1)
      await counter.put({ id: 'c', value: now + 1 })
    })

    await Promise.all(Array.from({ length: 20 }, (_, i) => bump(i % 2 ? one : two)))

    expect((await one.collection('counter').get('c'))?.value).toBe(20)
  })

  test('two Workers of one process on one folder take turns', async () => {
    const path = await folder()
    const worker = join(path, 'worker.ts')
    await Bun.write(worker, `
      import { FileStore } from ${JSON.stringify(join(import.meta.dir, 'file-store.ts'))}
      self.onmessage = async () => {
        const store = await FileStore.connect({ folder: ${JSON.stringify(join(path, 'store'))} })
        for (let i = 0; i < 20; i++) {
          await store.transaction(async () => {
            const counter = store.collection('counter')
            const now = (await counter.get('c'))?.value ?? 0
            await Bun.sleep(1)
            await counter.put({ id: 'c', value: now + 1 })
          })
        }
        postMessage('done')
      }`)
    const run = () => new Promise<void>(done => {
      const each = new Worker(worker)
      each.onmessage = () => { each.terminate(); done() }
      each.postMessage('go')
    })

    await Promise.all([run(), run()])

    expect((await (await FileStore.connect({ folder: join(path, 'store') })).collection('counter').get('c'))?.value).toBe(40)
  })

  test('a transaction whose lock was taken over while its process was stopped fails, and one run again commits', async () => {
    const path = await folder()
    const worker = join(path, 'worker.ts')
    await Bun.write(worker, `
      import { FileStore } from ${JSON.stringify(join(import.meta.dir, 'file-store.ts'))}
      self.onmessage = async () => {
        const store = await FileStore.connect({ folder: ${JSON.stringify(join(path, 'store'))} })
        const counter = store.collection('counter')
        let stopped = true
        for (;;) {
          try {
            await store.transaction(async () => {
              const now = (await counter.get('c'))?.value ?? 0
              if (stopped) {
                postMessage('holding')
                // Stopped longer than a lock goes untouched: a long synchronous step, a GC pause, SIGSTOP.
                Bun.sleepSync(6_000)
              }
              await counter.put({ id: 'c', value: now + 1 })
            })
            break
          } catch (error) {
            postMessage(error.constructor.name)
            stopped = false
          }
        }
        postMessage('done')
      }`)
    const each = new Worker(worker)
    const said: string[] = []
    const holding = new Promise<void>(ok => each.addEventListener('message', event => { if (event.data === 'holding') ok() }))
    const done = new Promise<void>(ok => each.addEventListener('message', event => { said.push(event.data); if (event.data === 'done') ok() }))
    each.postMessage('go')
    await holding
    const store = await FileStore.connect({ folder: join(path, 'store') })

    await store.transaction(async () => {
      const now = (await store.collection('counter').get('c'))?.value as number | undefined ?? 0
      await store.collection('counter').put({ id: 'c', value: now + 1 })
    })
    await done
    each.terminate()

    expect(said).toEqual(['holding', 'ConcurrencyConflict', 'done'])
    expect((await store.collection('counter').get('c'))?.value).toBe(2)
  }, 20_000)

  test('a read outside a transaction, stopped while another commits, reads again: one commit, never half of two', async () => {
    const path = await folder()
    const worker = join(path, 'worker.ts')
    await Bun.write(worker, `
      import { FileStore } from ${JSON.stringify(join(import.meta.dir, 'file-store.ts'))}
      self.onmessage = async () => {
        const store = await FileStore.connect({ folder: ${JSON.stringify(join(path, 'store'))} })
        const accounts = store.collection('account')
        await store.transaction(async () => {
          const a = (await accounts.get('a'))!, b = (await accounts.get('b'))!
          await accounts.put({ ...a, value: a.value - 10 })
          await accounts.put({ ...b, value: b.value + 10 })
        })
        postMessage('done')
      }`)
    const store = await FileStore.connect({ folder: join(path, 'store') })
    await store.collection('account').put({ id: 'a', value: 50 })
    await store.collection('account').put({ id: 'b', value: 50 })
    const each = new Worker(worker)
    const done = new Promise<void>(ok => each.addEventListener('message', () => ok()))
    const reading = store as unknown as { readRecord: (collection: string, id: string) => Promise<unknown> }
    const read = reading.readRecord.bind(store)
    let stopped = false
    reading.readRecord = async (collection, id) => {
      if (id === 'b' && !stopped) {
        stopped = true
        // The other record is read by then.
        await Bun.sleep(50)
        each.postMessage('go')
        // Stopped longer than a lock goes untouched, halfway through the read.
        Bun.sleepSync(6_000)
        await done
      }
      return read(collection, id)
    }

    const accounts = await store.loadAll('account')
    each.terminate()

    expect(Object.fromEntries(accounts.map(account => [account.id, account.value]))).toEqual({ a: 40, b: 60 })
  }, 20_000)

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

  test('a patch keeps unique values unique', async () => {
    const table = await open([['name']])
    await table.insert({ id: 't1', name: 'ana' })
    await table.insert({ id: 't2', name: 'bea' })

    await expect(table.patch('t2', { name: 'ana' })).rejects.toThrow(ConcurrencyConflict)
    expect((await table.find()).map(row => row.name)).toEqual(['ana', 'bea'])
  })

  test('two inserts awaited together in one transaction do not both pass the same check', async () => {
    const store = await FileStore.open({ folder: await folder() })
    const table = store.table<Row>('thing', { unique: [['name']] })

    await expect(store.transaction(() => Promise.all([table.insert({ id: 't1', name: 'ana' }), table.insert({ id: 't1', name: 'bea' })]))).rejects.toThrow(ConcurrencyConflict)
    await expect(store.transaction(() => Promise.all([table.insert({ id: 't1', name: 'ana' }), table.insert({ id: 't2', name: 'ana' })]))).rejects.toThrow(ConcurrencyConflict)
    expect(await table.count()).toBe(0)
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
