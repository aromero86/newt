import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { Entity, eventsOf, Module, UseCase, type DomainEvent, type EntityInput, type WriteRule } from '../core'
import { Base } from '../runtime'
import { TableRepository } from '../repository'
import { SqliteStore } from './sqlite-store'

const NoteSchema = z.object({ id: z.string(), text: z.string(), createdAt: z.string().default(''), updatedAt: z.string().default('') })
type NoteRow = z.infer<typeof NoteSchema> & { version: number }

class Note extends Entity<typeof NoteSchema> {
  static write(text: string) {
    return new Note(NoteSchema, { text } as EntityInput<z.infer<typeof NoteSchema>>, true)
  }
  static fromRow(row: NoteRow) {
    return new Note(NoteSchema, row, false)
  }
}

class Notes extends TableRepository<Note, NoteRow, Base> {
  protected toEntity(row: NoteRow) {
    return Note.fromRow(row)
  }

  /** Rows that are no entity's, written as a save does. */
  async stamp(text: string) {
    await this.saveRows(() => this.table.insert({ id: Bun.randomUUIDv7(), text, createdAt: '', updatedAt: '' }))
  }

  /** Saves one, running `before` first in its transaction, as a save hook does. */
  async persistAfter(before: () => Promise<void>, note: Note) {
    await this.save([note], entity => this.write(entity), { before })
  }
}

class Written implements DomainEvent<{ text: string }> {
  static readonly eventName = 'diary.written'
  readonly name = Written.eventName
  readonly occurredAt = ''
  constructor(readonly payload: { text: string }) {}
}

/** The module that writes in another one: `log`. */
class Diary extends Module {
  readonly events
  constructor(base: Base, private readonly log: Log) {
    super('diary', base.invocations)
    this.events = eventsOf(base.bus, { written: Written })
  }
  @UseCase()
  async writeBoth(text: string) { await this.log.add(text) }
  @UseCase({ writesTo: ['log'] })
  async writeBothOnPurpose(text: string) { await this.log.add(text) }
  @UseCase()
  async stampBoth(text: string) { await this.log.stamp(text) }
}

class Log extends Module {
  constructor(base: Base, private readonly notes: Notes) {
    super('log', base.invocations)
  }
  @UseCase()
  async add(text: string) { await this.notes.persist(Note.write(text)) }
  @UseCase()
  async stamp(text: string) { await this.notes.stamp(text) }
}

let store: SqliteStore

beforeEach(async () => {
  store = await SqliteStore.open({ path: ':memory:' })
  await store.transaction(() => store.connection.run('CREATE TABLE note (id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL)'))
})

afterEach(() => store.close())

function open(writeRule: WriteRule) {
  const base = new Base({ name: 'test', store, writeRule })
  const log = new Log(base, new Notes(base, store.table<NoteRow>('note')))
  return { base, log, diary: new Diary(base, log) }
}

describe('the write rule', () => {
  test('lets a use case write to its own module', async () => {
    const { log } = open('error')

    await log.add('mine')
    expect(await store.table('note').count()).toBe(1)
  })

  test('refuses a use case writing to another module outside a worker', async () => {
    const { diary } = open('error')

    await expect(diary.writeBoth('theirs')).rejects.toThrow('diary.writeBoth writes to test.log outside a worker')
    expect(await store.table('note').count()).toBe(0)
  })

  test("lets a use case call another context's, as an outside API", async () => {
    const shop = new Base({ name: 'shop', store, writeRule: 'error' })
    const other = new Base({ name: 'other', store, writeRule: 'error' })
    const log = new Log(other, new Notes(other, store.table<NoteRow>('note')))
    const diary = new Diary(shop, log)

    await diary.writeBoth('theirs')
    expect(await store.table('note').count()).toBe(1)
  })

  test('still holds inside the context that was called', async () => {
    const shop = new Base({ name: 'shop', store, writeRule: 'error' })
    const other = new Base({ name: 'other', store, writeRule: 'error' })
    const otherDiary = new Diary(other, new Log(other, new Notes(other, store.table<NoteRow>('note'))))
    class Caller extends Module {
      constructor() { super('caller', shop.invocations) }
      @UseCase()
      async callTheirs() { await otherDiary.writeBoth('theirs') }
    }

    await expect(new Caller().callTheirs()).rejects.toThrow('diary.writeBoth writes to other.log outside a worker')
  })

  test('is an error by default', async () => {
    const base = new Base({ name: 'test', store })
    const diary = new Diary(base, new Log(base, new Notes(base, store.table<NoteRow>('note'))))

    await expect(diary.writeBoth('theirs')).rejects.toThrow('outside a worker')
  })

  test('covers rows written with saveRows too', async () => {
    const { diary, log } = open('error')

    await log.stamp('mine')
    await expect(diary.stampBoth('theirs')).rejects.toThrow('diary.stampBoth writes to test.log outside a worker')
    expect(await store.table('note').count()).toBe(1)
  })

  test('lets it when its use case says so', async () => {
    const { diary } = open('error')

    await diary.writeBothOnPurpose('theirs')
    expect(await store.table('note').count()).toBe(1)
  })

  test('lets a worker write to any module', async () => {
    const { base, log, diary } = open('error')
    diary.events.written.subscribe(written => log.add(written.text), { strategy: 'handler', queue: 'log.add.on.diary.written' })
    base.jobs.start()

    await store.transaction(() => base.publisher.publish(new Written({ text: 'later' })))
    await base.jobs.idle()
    await base.jobs.stop()

    expect(await store.table('note').count()).toBe(1)
  })

  test('warn only warns, once for each use case and module', async () => {
    const { diary } = open('warn')
    const warnings: string[] = []
    const original = console.warn
    console.warn = (message: string) => { warnings.push(message) }
    try {
      await diary.writeBoth('one')
      await diary.writeBoth('two')
    } finally {
      console.warn = original
    }

    expect(warnings).toHaveLength(1)
    expect(await store.table('note').count()).toBe(2)
  })
})

/** A module with notes of its own, that also saves `log`'s: after its own, in its save, or beside it in one transaction. */
class Journal extends Module {
  constructor(base: Base, private readonly notes: Notes, private readonly log: Log) {
    super('journal', base.invocations)
  }
  @UseCase()
  async writeThenLog(text: string) {
    await this.notes.persist(Note.write(text))
    await this.log.add(text)
  }
  @UseCase()
  async logInItsSave(text: string) { await this.notes.persistAfter(() => this.log.add(text), Note.write(text)) }
  @UseCase()
  async logInOneTransaction(text: string) { await this.atOnce(text) }
  @UseCase({ writesTo: ['log'] })
  async logInOneTransactionOnPurpose(text: string) { await this.atOnce(text) }
  private atOnce(text: string) {
    return store.transaction(async () => {
      await this.notes.persist(Note.write(text))
      await this.log.add(text)
    })
  }
}

describe('the write rule, for one transaction', () => {
  function openJournal(writeRule: WriteRule) {
    const { base, log } = open(writeRule)
    return { base, journal: new Journal(base, new Notes(base, store.table<NoteRow>('note')), log) }
  }

  test('lets a worker save one module after another, each in its own', async () => {
    const { base, journal } = openJournal('error')

    await base.jobs.runAsWorker(() => journal.writeThenLog('both'))
    expect(await store.table('note').count()).toBe(2)
  })

  test("refuses a save hook that saves another module's in its transaction, in a worker too", async () => {
    const { base, journal } = openJournal('error')

    await expect(base.jobs.runAsWorker(() => journal.logInItsSave('both')))
      .rejects.toThrow('[write rule] journal.logInItsSave saves test.log in the transaction that saved test.journal')
    expect(await store.table('note').count()).toBe(0)
  })

  test('refuses two modules saved in one store.transaction, in a worker too', async () => {
    const { base, journal } = openJournal('error')

    await expect(base.jobs.runAsWorker(() => journal.logInOneTransaction('both'))).rejects.toThrow('saves test.log in the transaction that saved test.journal')
    expect(await store.table('note').count()).toBe(0)
  })

  test('lets them when the use case lists the other in its writesTo', async () => {
    const { journal } = openJournal('error')

    await journal.logInOneTransactionOnPurpose('both')
    expect(await store.table('note').count()).toBe(2)
  })

  test('warn only warns, and off checks nothing', async () => {
    const warnings: string[] = []
    const original = console.warn
    console.warn = (message: string) => { warnings.push(message) }
    try {
      const warned = openJournal('warn')
      await warned.base.jobs.runAsWorker(() => warned.journal.logInItsSave('one'))
      const off = openJournal('off')
      await off.base.jobs.runAsWorker(() => off.journal.logInItsSave('two'))
    } finally {
      console.warn = original
    }

    expect(warnings).toEqual([expect.stringContaining('journal.logInItsSave saves test.log')])
    expect(await store.table('note').count()).toBe(4)
  })
})
