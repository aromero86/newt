import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { Entity, eventsOf, Module, UseCase, type DomainEvent, type EntityInput, type WriteRule } from '../core'
import { Base } from '../runtime'
import { TableRepository } from '../store'
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
}

class Log extends Module {
  constructor(base: Base, private readonly notes: Notes) {
    super('log', base.invocations)
  }
  @UseCase()
  async add(text: string) { await this.notes.persist(Note.write(text)) }
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

  test('only warns by default, once for each pair', async () => {
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
