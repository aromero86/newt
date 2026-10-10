import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Base } from '../../base/base'
import { config } from '../../config'
import type { DomainEvent } from '../../core/events/domain-event'
import { NoteNotFound } from './errors/note-not-found'
import { Note_Module } from './note.module'

let base: Base
let notes: Note_Module
let events: DomainEvent[]

/** Handlers run on a microtask after the commit: let them run. */
const settle = () => Bun.sleep(0)

beforeEach(async () => {
  base = await Base.open({ ...config, dbPath: ':memory:' })
  notes = await Note_Module.initialize(base)
  events = []
  base.bus.subscribe('note.*', event => { events.push(event) })
})

afterEach(() => base.close())

describe('create', () => {
  test('stores the note and announces it after the commit', async () => {
    const note = await notes.create({ title: 'Kickoff', body: 'Agenda' })
    await settle()

    expect(await notes.find({ id: [note.id] })).toEqual([note])
    expect(events.map(event => [event.name, event.payload])).toEqual([['note.created', note]])
  })

  test('refuses an invalid note and stores nothing', async () => {
    await expect(notes.create({ title: '  ', body: '' })).rejects.toThrow()
    await settle()

    expect(await notes.count({})).toBe(0)
    expect(events).toEqual([])
  })

  test('stores nothing and announces nothing when the surrounding use case fails', async () => {
    const failing = base.transactions.run('test.fails', async () => {
      await notes.create({ title: 'Lost', body: '' })
      throw new Error('boom')
    })

    await expect(failing).rejects.toThrow('boom')
    await settle()
    expect(await notes.count({})).toBe(0)
    expect(events).toEqual([])
  })
})

describe('update', () => {
  test('announces the whole note and only what changed', async () => {
    const note = await notes.create({ title: 'Kickoff', body: 'Agenda' })
    const updated = await notes.update(note.id, { title: 'Kickoff, take two', body: 'Agenda' })
    await settle()

    expect(events[1]).toMatchObject({
      name: 'note.updated',
      payload: { dto: updated, changes: { title: 'Kickoff, take two' } },
    })
  })

  test('announces nothing when nothing changed', async () => {
    const note = await notes.create({ title: 'Kickoff', body: 'Agenda' })
    await notes.update(note.id, { title: 'Kickoff' })
    await settle()

    expect(events.map(event => event.name)).toEqual(['note.created'])
  })

  test('a note that does not exist is a 404', async () => {
    const missing = notes.update(Bun.randomUUIDv7(), { title: 'Nope' })

    await expect(missing).rejects.toThrow(NoteNotFound)
    await expect(missing.catch((error: NoteNotFound) => error.status)).resolves.toBe(404)
  })
})

describe('delete', () => {
  test('hides the note and announces it', async () => {
    const note = await notes.create({ title: 'Kickoff', body: '' })
    await notes.delete(note.id)
    await settle()

    expect(await notes.find({ id: [note.id] })).toEqual([])
    expect(await notes.count({})).toBe(0)
    expect(events.map(event => event.name)).toEqual(['note.created', 'note.deleted'])
  })
})

describe('find', () => {
  test('pages from the newest note back', async () => {
    const first = await notes.create({ title: 'First', body: '' })
    const second = await notes.create({ title: 'Second', body: '' })
    const third = await notes.create({ title: 'Third', body: '' })

    expect((await notes.find({}, { size: 2, fromId: '' })).map(note => note.title)).toEqual(['Third', 'Second'])
    expect((await notes.find({}, { size: 2, fromId: second.id })).map(note => note.id)).toEqual([first.id])
    expect(third.id > second.id).toBe(true)
  })
})
